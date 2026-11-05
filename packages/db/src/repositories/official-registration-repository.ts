/**
 * Persistence of official guest registrations (Meldewesen, ADR 0022, F2).
 *
 * - Server-only, tenant-scoped on every query; claimDue/purge are system operations across
 *   tenants (like the registration sync) and return tenant ids for follow-up calls.
 * - Stores ids, references, states, codes, fingerprints and instants – no guest data.
 * - Duplicate guards live in the database (unique keys, write-once reference, unique
 *   successful create per idempotency key); this module only maps and checks inputs.
 * - Nothing here talks to Feratel, and nothing activates a property.
 */
import {
  type GuestCardStatus,
  isEntityKey,
  type OfficialRegistrationSettings,
  officialRegistrationSettingsSchema,
  type OfficialRegistrationState,
  type OfficialRegistrationTarget,
  type OperationLogEntry,
  type TenantContext,
} from "@up/core";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { type Database } from "../client";
import {
  guestRegistrations,
  officialGuestCards,
  officialRegistrationEvents,
  officialRegistrations,
  officialRegistrationSettings,
} from "../schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function assertTenantContext(context: TenantContext): void {
  if (!isEntityKey(context.tenantId)) throw new TypeError("Invalid tenant context");
}

type SettingsRow = typeof officialRegistrationSettings.$inferSelect;
type StateRow = typeof officialRegistrations.$inferSelect;
type CardRow = typeof officialGuestCards.$inferSelect;
export type OfficialRegistrationEventRecord = typeof officialRegistrationEvents.$inferSelect;

/* ------------------------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------------------------- */

function settingsFromRow(row: SettingsRow): OfficialRegistrationSettings {
  return officialRegistrationSettingsSchema.parse({
    target: row.target,
    enabled: row.enabled,
    environment: row.environment,
    bindingRegistration:
      row.bindingRegistrationRule === "days-before-arrival"
        ? { rule: "days-before-arrival", days: row.bindingRegistrationDays }
        : { rule: "arrival-day" },
    ...(row.preRegistrationLeadDays !== null
      ? { preRegistrationLeadDays: row.preRegistrationLeadDays }
      : {}),
    allowedOperations: row.allowedOperations,
    guestCards: row.guestCards,
    childUnderAge: row.childUnderAge,
    providerSettings: row.providerSettings,
    ...(row.stateRetentionDays !== null
      ? { stateRetentionDaysAfterDeparture: row.stateRetentionDays }
      : {}),
    ...(row.eventRetentionDays !== null ? { eventRetentionDays: row.eventRetentionDays } : {}),
  });
}

export async function getOfficialRegistrationSettings(
  db: Database,
  context: TenantContext,
  propertyId: string,
  target: OfficialRegistrationTarget,
): Promise<OfficialRegistrationSettings | undefined> {
  assertTenantContext(context);
  if (!isEntityKey(propertyId)) return undefined;
  const [row] = await db
    .select()
    .from(officialRegistrationSettings)
    .where(
      and(
        eq(officialRegistrationSettings.tenantId, context.tenantId),
        eq(officialRegistrationSettings.propertyId, propertyId),
        eq(officialRegistrationSettings.target, target),
      ),
    );
  return row ? settingsFromRow(row) : undefined;
}

/** Admin/seed: creates or replaces the settings (validated; enabled ⇒ simulated only). */
export async function saveOfficialRegistrationSettings(
  db: Database,
  context: TenantContext,
  propertyId: string,
  input: OfficialRegistrationSettings,
): Promise<OfficialRegistrationSettings> {
  assertTenantContext(context);
  if (!isEntityKey(propertyId)) throw new TypeError("Invalid property id");
  const settings = officialRegistrationSettingsSchema.parse(input);
  const values = {
    enabled: settings.enabled,
    environment: settings.environment,
    bindingRegistrationRule: settings.bindingRegistration.rule,
    bindingRegistrationDays:
      settings.bindingRegistration.rule === "days-before-arrival"
        ? settings.bindingRegistration.days
        : null,
    preRegistrationLeadDays: settings.preRegistrationLeadDays ?? null,
    allowedOperations: [...settings.allowedOperations],
    guestCards: settings.guestCards,
    childUnderAge: settings.childUnderAge,
    providerSettings: { ...settings.providerSettings },
    stateRetentionDays: settings.stateRetentionDaysAfterDeparture ?? null,
    eventRetentionDays: settings.eventRetentionDays ?? null,
  };
  await db
    .insert(officialRegistrationSettings)
    .values({ tenantId: context.tenantId, propertyId, target: settings.target, ...values })
    .onConflictDoUpdate({
      target: [
        officialRegistrationSettings.tenantId,
        officialRegistrationSettings.propertyId,
        officialRegistrationSettings.target,
      ],
      set: {
        ...values,
        version: sql`${officialRegistrationSettings.version} + 1`,
        updatedAt: new Date(),
      },
    });
  return settings;
}

/* ------------------------------------------------------------------------------------------
 * State
 * ---------------------------------------------------------------------------------------- */

export type OfficialRegistrationRecord = OfficialRegistrationState & {
  id: string;
  reservationProvider: string;
  externalReservationId: string;
  ourReference: string;
  leaseUntil?: Date;
  purgeAfter?: Date;
};

function toState(row: StateRow, card: CardRow | undefined): OfficialRegistrationRecord {
  const state: OfficialRegistrationRecord = {
    id: row.id,
    registrationId: row.registrationId,
    tenantId: row.tenantId,
    propertyId: row.propertyId,
    target: row.target,
    reservationProvider: row.reservationProvider,
    externalReservationId: row.externalReservationId,
    ourReference: row.ourReference,
    stage: row.stage,
    transmission: row.transmission,
    attempts: row.attempts,
    guestCard: card
      ? { status: card.status, updatedAt: card.statusChangedAt }
      : { status: "not-applicable" },
    version: row.version,
  };
  if (row.externalReference) state.externalReference = row.externalReference;
  if (row.acceptedFingerprint && row.acceptedGuestFingerprint) {
    state.acceptedFingerprint = row.acceptedFingerprint;
    state.acceptedGuestFingerprint = row.acceptedGuestFingerprint;
  }
  if (row.acceptedArrivalDate && row.acceptedDepartureDate) {
    state.acceptedStay = {
      arrivalDate: row.acceptedArrivalDate,
      departureDate: row.acceptedDepartureDate,
    };
  }
  if (row.nextAttemptAt) state.nextAttemptAt = row.nextAttemptAt;
  if (row.lastErrorCode) state.lastErrorCode = row.lastErrorCode;
  if (row.manualReason) state.manualReason = row.manualReason;
  if (
    row.unresolvedOperation &&
    row.unresolvedIdempotencyKey &&
    row.unresolvedFingerprint &&
    row.unresolvedGuestFingerprint &&
    row.unresolvedArrivalDate &&
    row.unresolvedDepartureDate &&
    row.unresolvedAt
  ) {
    state.unresolved = {
      operation: row.unresolvedOperation,
      idempotencyKey: row.unresolvedIdempotencyKey,
      fingerprint: row.unresolvedFingerprint,
      guestFingerprint: row.unresolvedGuestFingerprint,
      stay: { arrivalDate: row.unresolvedArrivalDate, departureDate: row.unresolvedDepartureDate },
      at: row.unresolvedAt,
    };
  }
  if (row.leaseUntil) state.leaseUntil = row.leaseUntil;
  if (row.purgeAfter) state.purgeAfter = row.purgeAfter;
  return state;
}

async function loadCard(
  db: Database,
  tenantId: string,
  officialRegistrationId: string,
): Promise<CardRow | undefined> {
  const [card] = await db
    .select()
    .from(officialGuestCards)
    .where(
      and(
        eq(officialGuestCards.tenantId, tenantId),
        eq(officialGuestCards.officialRegistrationId, officialRegistrationId),
      ),
    );
  return card;
}

export async function getOfficialRegistration(
  db: Database,
  context: TenantContext,
  registrationId: string,
  target: OfficialRegistrationTarget,
): Promise<OfficialRegistrationRecord | undefined> {
  assertTenantContext(context);
  if (!UUID.test(registrationId)) return undefined;
  const [row] = await db
    .select()
    .from(officialRegistrations)
    .where(
      and(
        eq(officialRegistrations.tenantId, context.tenantId),
        eq(officialRegistrations.registrationId, registrationId),
        eq(officialRegistrations.target, target),
      ),
    );
  if (!row) return undefined;
  return toState(row, await loadCard(db, row.tenantId, row.id));
}

export type EnsureResult =
  | { ok: true; created: boolean; record: OfficialRegistrationRecord }
  | { ok: false; reason: "registration-not-found" | "not-submitted" | "no-settings" };

/**
 * Creates the state row (and the guest card row) for a submitted check-in – exactly once.
 * Property and reservation are taken from the check-in itself, never from the caller.
 */
export async function ensureOfficialRegistration(
  db: Database,
  context: TenantContext,
  input: { registrationId: string; target: OfficialRegistrationTarget; now: Date },
): Promise<EnsureResult> {
  assertTenantContext(context);
  if (!UUID.test(input.registrationId)) return { ok: false, reason: "registration-not-found" };
  return db.transaction(async (tx) => {
    const [registration] = await tx
      .select({
        id: guestRegistrations.id,
        propertyId: guestRegistrations.propertyId,
        status: guestRegistrations.status,
        reservationProvider: guestRegistrations.reservationProvider,
        externalReservationId: guestRegistrations.externalReservationId,
      })
      .from(guestRegistrations)
      .where(
        and(
          eq(guestRegistrations.tenantId, context.tenantId),
          eq(guestRegistrations.id, input.registrationId),
        ),
      );
    if (!registration) return { ok: false, reason: "registration-not-found" } as const;
    if (registration.status !== "submitted") return { ok: false, reason: "not-submitted" } as const;
    const settings = await getOfficialRegistrationSettings(
      tx,
      context,
      registration.propertyId,
      input.target,
    );
    if (!settings) return { ok: false, reason: "no-settings" } as const;
    const inserted = await tx
      .insert(officialRegistrations)
      .values({
        tenantId: context.tenantId,
        propertyId: registration.propertyId,
        target: input.target,
        registrationId: registration.id,
        reservationProvider: registration.reservationProvider,
        externalReservationId: registration.externalReservationId,
        ourReference: `up-${registration.id}`,
      })
      .onConflictDoNothing()
      .returning({ id: officialRegistrations.id });
    const created = inserted[0];
    if (created) {
      await tx.insert(officialGuestCards).values({
        tenantId: context.tenantId,
        officialRegistrationId: created.id,
        status: settings.guestCards ? "waiting" : "not-applicable",
        statusChangedAt: input.now,
      });
    }
    const record = await getOfficialRegistration(tx, context, registration.id, input.target);
    if (!record) {
      // The reservation already has a state from another check-in (duplicate guard).
      throw new Error("Reservation already has an official registration for this target");
    }
    return { ok: true, created: created !== undefined, record } as const;
  });
}

export type SaveResult = { ok: true; version: number } | { ok: false; reason: "conflict" };

function eventValues(
  record: Pick<
    OfficialRegistrationRecord,
    "id" | "tenantId" | "propertyId" | "target" | "registrationId"
  >,
  entry: OperationLogEntry,
  guestCardAfter: GuestCardStatus | undefined,
  purgeAfter: Date | undefined,
): typeof officialRegistrationEvents.$inferInsert {
  if (entry.registrationId !== record.registrationId) {
    throw new TypeError("Event belongs to another registration");
  }
  return {
    tenantId: record.tenantId,
    propertyId: record.propertyId,
    target: record.target,
    officialRegistrationId: record.id,
    operation: entry.operation,
    result: entry.result,
    code: entry.code ?? null,
    attempt: entry.attempt ?? null,
    idempotencyKey: entry.idempotencyKey ?? null,
    manualReason: entry.manualReason ?? null,
    actor: entry.actor.kind,
    adminUserId: entry.actor.kind === "admin" ? entry.actor.adminUserId : null,
    stageAfter: entry.stageAfter,
    transmissionAfter: entry.transmissionAfter,
    guestCardAfter: guestCardAfter ?? null,
    occurredAt: entry.at,
    purgeAfter: purgeAfter ?? null,
  };
}

/**
 * Persists the state after a run or staff action together with its protocol entries –
 * atomically, with optimistic concurrency on the stored version. Releases the lease.
 */
export async function saveOfficialRegistrationState(
  db: Database,
  context: TenantContext,
  input: {
    record: OfficialRegistrationRecord;
    next: OfficialRegistrationState;
    log: readonly OperationLogEntry[];
    now: Date;
    /** From settings: departure + stateRetentionDays. */
    purgeAfter?: Date;
    /** From settings: now + eventRetentionDays. */
    eventPurgeAfter?: Date;
  },
): Promise<SaveResult> {
  assertTenantContext(context);
  const { record, next } = input;
  if (record.tenantId !== context.tenantId || next.tenantId !== context.tenantId) {
    throw new TypeError("Tenant mismatch");
  }
  if (next.registrationId !== record.registrationId || next.propertyId !== record.propertyId) {
    throw new TypeError("Identity mismatch");
  }
  return db.transaction(async (tx) => {
    const version = record.version + 1;
    const updated = await tx
      .update(officialRegistrations)
      .set({
        stage: next.stage,
        transmission: next.transmission,
        externalReference: next.externalReference ?? null,
        acceptedFingerprint: next.acceptedFingerprint ?? null,
        acceptedGuestFingerprint: next.acceptedGuestFingerprint ?? null,
        acceptedArrivalDate: next.acceptedStay?.arrivalDate ?? null,
        acceptedDepartureDate: next.acceptedStay?.departureDate ?? null,
        attempts: next.attempts,
        lastAttemptAt: input.log.some((entry) => entry.actor.kind === "system" && entry.attempt)
          ? input.now
          : sql`${officialRegistrations.lastAttemptAt}`,
        nextAttemptAt: next.nextAttemptAt ?? null,
        leaseUntil: null,
        lastErrorCode: next.lastErrorCode ?? null,
        manualReason: next.manualReason ?? null,
        unresolvedOperation: next.unresolved?.operation ?? null,
        unresolvedIdempotencyKey: next.unresolved?.idempotencyKey ?? null,
        unresolvedFingerprint: next.unresolved?.fingerprint ?? null,
        unresolvedGuestFingerprint: next.unresolved?.guestFingerprint ?? null,
        unresolvedArrivalDate: next.unresolved?.stay.arrivalDate ?? null,
        unresolvedDepartureDate: next.unresolved?.stay.departureDate ?? null,
        unresolvedAt: next.unresolved?.at ?? null,
        ...(input.purgeAfter ? { purgeAfter: input.purgeAfter } : {}),
        version,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(officialRegistrations.tenantId, context.tenantId),
          eq(officialRegistrations.id, record.id),
          eq(officialRegistrations.version, record.version),
        ),
      )
      .returning({ id: officialRegistrations.id });
    if (updated.length === 0) return { ok: false, reason: "conflict" } as const;

    const cardChanged = next.guestCard.status !== record.guestCard.status;
    if (cardChanged) {
      await tx
        .update(officialGuestCards)
        .set({
          status: next.guestCard.status,
          statusChangedAt: next.guestCard.updatedAt ?? input.now,
          version: sql`${officialGuestCards.version} + 1`,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(officialGuestCards.tenantId, context.tenantId),
            eq(officialGuestCards.officialRegistrationId, record.id),
          ),
        );
    }
    if (input.log.length > 0) {
      await tx
        .insert(officialRegistrationEvents)
        .values(
          input.log.map((entry) =>
            eventValues(
              record,
              entry,
              cardChanged ? next.guestCard.status : undefined,
              input.eventPurgeAfter,
            ),
          ),
        );
    }
    return { ok: true, version } as const;
  });
}

/**
 * System: claims due rows of ENABLED properties for one target with a lease. Rows in a final
 * stage, waiting for staff or still leased are skipped.
 */
export async function claimDueOfficialRegistrations(
  db: Database,
  input: { now: Date; target: OfficialRegistrationTarget; limit: number; leaseMs: number },
): Promise<{ tenantId: string; registrationId: string; id: string }[]> {
  const due = db
    .select({ id: officialRegistrations.id })
    .from(officialRegistrations)
    .innerJoin(
      officialRegistrationSettings,
      and(
        eq(officialRegistrationSettings.tenantId, officialRegistrations.tenantId),
        eq(officialRegistrationSettings.propertyId, officialRegistrations.propertyId),
        eq(officialRegistrationSettings.target, officialRegistrations.target),
      ),
    )
    .where(
      and(
        eq(officialRegistrations.target, input.target),
        eq(officialRegistrationSettings.enabled, true),
        notInArray(officialRegistrations.transmission, ["manual", "failed"]),
        notInArray(officialRegistrations.stage, ["checked-out", "cancelled"]),
        or(
          isNull(officialRegistrations.nextAttemptAt),
          lte(officialRegistrations.nextAttemptAt, input.now),
        ),
        or(
          isNull(officialRegistrations.leaseUntil),
          lt(officialRegistrations.leaseUntil, input.now),
        ),
      ),
    )
    .orderBy(asc(officialRegistrations.updatedAt))
    .limit(Math.max(1, Math.min(input.limit, 100)))
    .for("update", { of: officialRegistrations, skipLocked: true });
  return db
    .update(officialRegistrations)
    .set({ leaseUntil: new Date(input.now.getTime() + input.leaseMs) })
    .where(inArray(officialRegistrations.id, due))
    .returning({
      tenantId: officialRegistrations.tenantId,
      registrationId: officialRegistrations.registrationId,
      id: officialRegistrations.id,
    });
}

export async function listOfficialRegistrationEvents(
  db: Database,
  context: TenantContext,
  officialRegistrationId: string,
): Promise<OfficialRegistrationEventRecord[]> {
  assertTenantContext(context);
  if (!UUID.test(officialRegistrationId)) return [];
  return db
    .select()
    .from(officialRegistrationEvents)
    .where(
      and(
        eq(officialRegistrationEvents.tenantId, context.tenantId),
        eq(officialRegistrationEvents.officialRegistrationId, officialRegistrationId),
      ),
    )
    .orderBy(asc(officialRegistrationEvents.occurredAt), asc(officialRegistrationEvents.createdAt));
}

/** Admin list per property (status overview, F6). */
export async function listOfficialRegistrations(
  db: Database,
  context: TenantContext,
  propertyId: string,
  target: OfficialRegistrationTarget,
): Promise<OfficialRegistrationRecord[]> {
  assertTenantContext(context);
  if (!isEntityKey(propertyId)) return [];
  const rows = await db
    .select({ state: officialRegistrations, card: officialGuestCards })
    .from(officialRegistrations)
    .leftJoin(
      officialGuestCards,
      and(
        eq(officialGuestCards.tenantId, officialRegistrations.tenantId),
        eq(officialGuestCards.officialRegistrationId, officialRegistrations.id),
      ),
    )
    .where(
      and(
        eq(officialRegistrations.tenantId, context.tenantId),
        eq(officialRegistrations.propertyId, propertyId),
        eq(officialRegistrations.target, target),
      ),
    )
    .orderBy(asc(officialRegistrations.createdAt));
  return rows.map((row) => toState(row.state, row.card ?? undefined));
}

/**
 * System: retention purge. Removes protocol entries whose purge date passed, then state rows
 * (with their guest card) whose purge date passed and that have no protocol left.
 */
export async function purgeOfficialRegistrationData(
  db: Database,
  now: Date,
): Promise<{ events: number; registrations: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL up.official_retention_purge = 'on'`);
    const events = await tx
      .delete(officialRegistrationEvents)
      .where(
        and(
          isNotNull(officialRegistrationEvents.purgeAfter),
          lte(officialRegistrationEvents.purgeAfter, now),
          // The trigger compares with now(); stay on the safe side of both clocks.
          lte(officialRegistrationEvents.purgeAfter, sql`now()`),
        ),
      )
      .returning({ id: officialRegistrationEvents.id });
    const dueStates = await tx
      .select({ id: officialRegistrations.id, tenantId: officialRegistrations.tenantId })
      .from(officialRegistrations)
      .where(
        and(
          isNotNull(officialRegistrations.purgeAfter),
          lte(officialRegistrations.purgeAfter, now),
          lte(officialRegistrations.purgeAfter, sql`now()`),
          sql`NOT EXISTS (SELECT 1 FROM ${officialRegistrationEvents} e WHERE e.tenant_id = ${officialRegistrations.tenantId} AND e.official_registration_id = ${officialRegistrations.id})`,
        ),
      );
    const ids = dueStates.map((row) => row.id);
    if (ids.length > 0) {
      await tx
        .delete(officialGuestCards)
        .where(inArray(officialGuestCards.officialRegistrationId, ids));
      await tx.delete(officialRegistrations).where(inArray(officialRegistrations.id, ids));
    }
    return { events: events.length, registrations: ids.length };
  });
}
