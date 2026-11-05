import {
  isEntityKey,
  isReservationProvider,
  type PaymentState,
  type ReservationProvider,
  type TenantContext,
} from "@up/core";
import { and, eq, inArray, sql } from "drizzle-orm";

import { type Database } from "../client";
import {
  OPEN_PAYMENT_REQUEST_STATUSES,
  type PAYMENT_REQUEST_STATUSES,
  paymentAuditEvents,
  paymentRequests,
  reservationPaymentStates,
} from "../schema";

/**
 * Payment persistence (Phase 12 B1, ADR 0018). Server-only, tenant-scoped on every query.
 * Stores IDs, amounts (minor units), states and instants – never card data, link URLs or
 * provider payloads. Nothing here talks to a payment provider.
 */

export type PaymentReservationKey = {
  reservationProvider: ReservationProvider;
  externalReservationId: string;
};

export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];
export type PaymentRequestRecord = typeof paymentRequests.$inferSelect;
export type ReservationPaymentStateRecord = typeof reservationPaymentStates.$inferSelect;
export type PaymentAuditEventRecord = typeof paymentAuditEvents.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const RETURN_REF = /^[A-Za-z0-9_-]{32,64}$/;
const CURRENCY = /^[A-Z]{3}$/;

function assertTenantContext(context: TenantContext): void {
  if (!isEntityKey(context.tenantId)) throw new TypeError("Invalid tenant context");
}

function assertReservation(key: PaymentReservationKey): void {
  if (!isReservationProvider(key.reservationProvider)) throw new TypeError("Invalid provider");
  const id = key.externalReservationId;
  if (id.trim().length === 0 || id.length > 255) throw new TypeError("Invalid reservation id");
}

function assertAmount(amountMinor: number, currency: string): void {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new RangeError("Invalid amount");
  if (!CURRENCY.test(currency)) throw new RangeError("Invalid currency");
}

const reservationWhere = (context: TenantContext, key: PaymentReservationKey) =>
  and(
    eq(reservationPaymentStates.tenantId, context.tenantId),
    eq(reservationPaymentStates.reservationProvider, key.reservationProvider),
    eq(reservationPaymentStates.externalReservationId, key.externalReservationId),
  );

// ── Reservation payment state ───────────────────────────────────────────────────────────

export async function getReservationPaymentState(
  db: Database,
  context: TenantContext,
  key: PaymentReservationKey,
): Promise<ReservationPaymentStateRecord | undefined> {
  assertTenantContext(context);
  assertReservation(key);
  const [row] = await db
    .select()
    .from(reservationPaymentStates)
    .where(reservationWhere(context, key))
    .limit(1);
  return row;
}

export type PaymentObservation = PaymentReservationKey & {
  propertyId: string;
  externalBookingId?: string;
  state: PaymentState;
  /** When the provider data was read – the documented "Prüfzeitpunkt". */
  observedAt: Date;
  /** Only when the provider confirmed settlement (see @up/core confirmsPayment). */
  confirmed?: { amountMinor: number; currency: string; providerPaymentIds: readonly string[] };
};

/**
 * Records one evaluation of the provider data. Always updates `last_checked_at`; writes an
 * audit event when the state changes; sets `cleared_at` once – on the first confirmed
 * settlement – and records it with the confirming provider payment ids. Concurrent calls
 * are serialised per reservation (row lock), so "cleared" is recorded exactly once.
 */
export async function recordPaymentObservation(
  db: Database,
  context: TenantContext,
  observation: PaymentObservation,
): Promise<ReservationPaymentStateRecord> {
  assertTenantContext(context);
  assertReservation(observation);
  if (!isEntityKey(observation.propertyId)) throw new TypeError("Invalid property");
  if (observation.confirmed) {
    assertAmount(observation.confirmed.amountMinor, observation.confirmed.currency);
  }
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(reservationPaymentStates)
      .values({
        tenantId: context.tenantId,
        propertyId: observation.propertyId,
        reservationProvider: observation.reservationProvider,
        externalReservationId: observation.externalReservationId,
        externalBookingId: observation.externalBookingId ?? null,
        lastState: observation.state,
        lastCheckedAt: observation.observedAt,
      })
      .onConflictDoNothing()
      .returning({ tenantId: reservationPaymentStates.tenantId });
    const [current] = await tx
      .select()
      .from(reservationPaymentStates)
      .where(reservationWhere(context, observation))
      .for("update");
    if (!current) throw new Error("Payment state row missing");
    if (current.propertyId !== observation.propertyId) {
      throw new TypeError("Reservation belongs to another property");
    }

    const changed = inserted.length > 0 || current.lastState !== observation.state;
    const clears = observation.confirmed !== undefined && current.clearedAt === null;

    const [updated] = await tx
      .update(reservationPaymentStates)
      .set({
        lastState: observation.state,
        lastCheckedAt: observation.observedAt,
        updatedAt: new Date(),
        ...(clears && observation.confirmed
          ? {
              clearedAt: observation.observedAt,
              clearedAmountMinor: observation.confirmed.amountMinor,
              clearedCurrency: observation.confirmed.currency,
            }
          : {}),
      })
      .where(reservationWhere(context, observation))
      .returning();
    if (!updated) throw new Error("Payment state row missing");

    const base = {
      tenantId: context.tenantId,
      propertyId: observation.propertyId,
      reservationProvider: observation.reservationProvider,
      externalReservationId: observation.externalReservationId,
      observedAt: observation.observedAt,
    };
    if (changed) {
      await tx.insert(paymentAuditEvents).values({
        ...base,
        kind: "state-observed",
        state: observation.state,
      });
    }
    if (clears && observation.confirmed) {
      await tx.insert(paymentAuditEvents).values({
        ...base,
        kind: "payment-confirmed",
        state: observation.state,
        amountMinor: observation.confirmed.amountMinor,
        currency: observation.confirmed.currency,
        providerPaymentIds: [...observation.confirmed.providerPaymentIds],
      });
    }
    return updated;
  });
}

// ── Payment requests (data layer for Phase B2 – no provider calls here) ────────────────

export type OpenPaymentRequestInput = PaymentReservationKey & {
  propertyId: string;
  externalBookingId?: string;
  paymentProvider: "apaleo";
  folioId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  returnRef: string;
  expiresAt: Date;
  actor: "system" | "guest";
};

/**
 * Reserves the one open request of a folio. If one exists (other tab, double click, retry)
 * it is returned instead – the partial unique index makes a second one impossible even
 * under concurrency.
 */
export async function openPaymentRequest(
  db: Database,
  context: TenantContext,
  input: OpenPaymentRequestInput,
): Promise<{ created: boolean; request: PaymentRequestRecord }> {
  assertTenantContext(context);
  assertReservation(input);
  if (!isEntityKey(input.propertyId)) throw new TypeError("Invalid property");
  if (input.folioId.trim().length === 0 || input.folioId.length > 255) {
    throw new TypeError("Invalid folio");
  }
  assertAmount(input.amountMinor, input.currency);
  if (!SHA256.test(input.idempotencyKey)) throw new TypeError("Invalid idempotency key");
  if (!RETURN_REF.test(input.returnRef)) throw new TypeError("Invalid return reference");
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(paymentRequests)
      .values({
        tenantId: context.tenantId,
        propertyId: input.propertyId,
        reservationProvider: input.reservationProvider,
        externalReservationId: input.externalReservationId,
        externalBookingId: input.externalBookingId ?? null,
        paymentProvider: input.paymentProvider,
        folioId: input.folioId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        idempotencyKey: input.idempotencyKey,
        returnRef: input.returnRef,
        expiresAt: input.expiresAt,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      await tx.insert(paymentAuditEvents).values({
        tenantId: context.tenantId,
        propertyId: input.propertyId,
        reservationProvider: input.reservationProvider,
        externalReservationId: input.externalReservationId,
        folioId: input.folioId,
        paymentRequestId: inserted.id,
        kind: "request-created",
        state: inserted.status,
        amountMinor: inserted.amountMinor,
        currency: inserted.currency,
        observedAt: inserted.createdAt,
        actor: input.actor,
      });
      return { created: true, request: inserted };
    }
    const [existing] = await tx
      .select()
      .from(paymentRequests)
      .where(
        and(
          eq(paymentRequests.tenantId, context.tenantId),
          eq(paymentRequests.paymentProvider, input.paymentProvider),
          eq(paymentRequests.folioId, input.folioId),
          inArray(paymentRequests.status, [...OPEN_PAYMENT_REQUEST_STATUSES]),
        ),
      )
      .limit(1);
    if (!existing) {
      // Conflict on idempotency key / return ref of a finished request: never reuse it.
      throw new Error("Payment request conflict");
    }
    if (
      existing.externalReservationId !== input.externalReservationId ||
      existing.reservationProvider !== input.reservationProvider
    ) {
      throw new TypeError("Folio belongs to another reservation");
    }
    return { created: false, request: existing };
  });
}

/** Allowed transitions; final states never change again. */
const TRANSITIONS: Record<PaymentRequestStatus, readonly PaymentRequestStatus[]> = {
  preparing: ["pending", "failed", "canceled"],
  pending: ["succeeded", "failed", "canceled", "expired"],
  succeeded: [],
  failed: [],
  canceled: [],
  expired: [],
};
const FINAL = new Set<PaymentRequestStatus>(["succeeded", "failed", "canceled", "expired"]);

/**
 * Moves a request to its next status (from provider data only – Phase B2/B3), with the
 * check instant and an audit event. Returns undefined if the transition is not allowed
 * (e.g. already final) – callers re-read and do nothing.
 */
export async function updatePaymentRequestStatus(
  db: Database,
  context: TenantContext,
  input: {
    id: string;
    status: PaymentRequestStatus;
    checkedAt: Date;
    providerPaymentId?: string;
    actor?: "system" | "guest";
  },
): Promise<PaymentRequestRecord | undefined> {
  assertTenantContext(context);
  if (!UUID.test(input.id)) return undefined;
  const from = (Object.keys(TRANSITIONS) as PaymentRequestStatus[]).filter((status) =>
    TRANSITIONS[status].includes(input.status),
  );
  if (from.length === 0) return undefined;
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(paymentRequests)
      .set({
        status: input.status,
        lastCheckedAt: input.checkedAt,
        updatedAt: new Date(),
        ...(input.providerPaymentId ? { providerPaymentId: input.providerPaymentId } : {}),
        ...(FINAL.has(input.status) ? { settledAt: input.checkedAt } : {}),
      })
      .where(
        and(
          eq(paymentRequests.tenantId, context.tenantId),
          eq(paymentRequests.id, input.id),
          inArray(paymentRequests.status, from),
        ),
      )
      .returning();
    if (!updated) return undefined;
    await tx.insert(paymentAuditEvents).values({
      tenantId: context.tenantId,
      propertyId: updated.propertyId,
      reservationProvider: updated.reservationProvider,
      externalReservationId: updated.externalReservationId,
      folioId: updated.folioId,
      paymentRequestId: updated.id,
      kind: "request-status-changed",
      state: updated.status,
      amountMinor: updated.amountMinor,
      currency: updated.currency,
      providerPaymentIds: updated.providerPaymentId ? [updated.providerPaymentId] : [],
      observedAt: input.checkedAt,
      actor: input.actor ?? "system",
    });
    return updated;
  });
}

/** Open requests of a reservation (all its folios). */
export async function listOpenPaymentRequests(
  db: Database,
  context: TenantContext,
  key: PaymentReservationKey,
): Promise<PaymentRequestRecord[]> {
  assertTenantContext(context);
  assertReservation(key);
  return db
    .select()
    .from(paymentRequests)
    .where(
      and(
        eq(paymentRequests.tenantId, context.tenantId),
        eq(paymentRequests.reservationProvider, key.reservationProvider),
        eq(paymentRequests.externalReservationId, key.externalReservationId),
        inArray(paymentRequests.status, [...OPEN_PAYMENT_REQUEST_STATUSES]),
      ),
    );
}

/**
 * The request behind a return URL – only within the tenant AND the session's reservation,
 * so a guessed or foreign reference reveals nothing.
 */
export async function findPaymentRequestByReturnRef(
  db: Database,
  context: TenantContext,
  key: PaymentReservationKey,
  returnRef: string,
): Promise<PaymentRequestRecord | undefined> {
  assertTenantContext(context);
  assertReservation(key);
  if (!RETURN_REF.test(returnRef)) return undefined;
  const [row] = await db
    .select()
    .from(paymentRequests)
    .where(
      and(
        eq(paymentRequests.tenantId, context.tenantId),
        eq(paymentRequests.reservationProvider, key.reservationProvider),
        eq(paymentRequests.externalReservationId, key.externalReservationId),
        eq(paymentRequests.returnRef, returnRef),
      ),
    )
    .limit(1);
  return row;
}

/** Audit trail of a reservation, oldest first (support / admin view, Phase C3). */
export async function listPaymentAuditEvents(
  db: Database,
  context: TenantContext,
  key: PaymentReservationKey,
): Promise<PaymentAuditEventRecord[]> {
  assertTenantContext(context);
  assertReservation(key);
  return db
    .select()
    .from(paymentAuditEvents)
    .where(
      and(
        eq(paymentAuditEvents.tenantId, context.tenantId),
        eq(paymentAuditEvents.reservationProvider, key.reservationProvider),
        eq(paymentAuditEvents.externalReservationId, key.externalReservationId),
      ),
    )
    .orderBy(sql`${paymentAuditEvents.observedAt} ASC, ${paymentAuditEvents.createdAt} ASC`);
}
