/**
 * Service operations (Extras migration M1): property service settings, the production writer
 * state (prepared joint go-live), the central Apaleo write log and the notification outbox.
 * No guest names, e-mail addresses or free texts are stored here.
 */
import {
  DEFAULT_STAY_EXTENSION_SETTINGS,
  isEntityKey,
  type StayExtensionSettings,
  type TenantContext,
} from "@up/core";
import { and, eq, sql } from "drizzle-orm";

import { type Database } from "../client";
import {
  type APALEO_WRITE_OPERATIONS,
  type APALEO_WRITE_STATUSES,
  type APALEO_WRITE_TRIGGERS,
  apaleoWriteOperations,
  type GO_LIVE_STATES,
  type NOTIFICATION_CHANNELS,
  notificationOutbox,
  propertyServiceSettings,
  type SERVICE_WRITERS,
  tenantServiceSettings,
} from "../schema";
import { assertSafeAuditDetails, recordAdminAuditEvent } from "./audit-repository";

function assertTenantContext(context: TenantContext): void {
  if (!isEntityKey(context.tenantId)) throw new TypeError("Invalid tenant context");
}

/* ------------------------------------------------------------------------------------------
 * Property service settings (stay extension, Slack route)
 * ---------------------------------------------------------------------------------------- */

export type PropertyServiceSettings = StayExtensionSettings & { slackRoute: string | null };

export async function getPropertyServiceSettings(
  db: Database,
  context: TenantContext,
  propertyId: string,
): Promise<PropertyServiceSettings> {
  assertTenantContext(context);
  const [row] = await db
    .select()
    .from(propertyServiceSettings)
    .where(
      and(
        eq(propertyServiceSettings.tenantId, context.tenantId),
        eq(propertyServiceSettings.propertyId, propertyId),
      ),
    );
  if (!row) return { ...DEFAULT_STAY_EXTENSION_SETTINGS, slackRoute: null };
  return {
    extensionNightEnabled: row.extensionNightEnabled,
    extensionDiscountPreArrivalOneNightGap: row.discountPreArrivalOneNightGap,
    extensionDiscountPreArrivalStandard: row.discountPreArrivalStandard,
    extensionDiscountInHouseOneNightGap: row.discountInHouseOneNightGap,
    extensionDiscountInHouseStandard: row.discountInHouseStandard,
    minSellableStayNights: row.minSellableStayNights,
    slackRoute: row.slackRoute,
  };
}

export async function upsertPropertyServiceSettings(
  db: Database,
  context: TenantContext,
  input: { propertyId: string; settings: PropertyServiceSettings; actorAdminId: string | null },
): Promise<void> {
  assertTenantContext(context);
  const s = input.settings;
  const values = {
    extensionNightEnabled: s.extensionNightEnabled,
    discountPreArrivalOneNightGap: s.extensionDiscountPreArrivalOneNightGap,
    discountPreArrivalStandard: s.extensionDiscountPreArrivalStandard,
    discountInHouseOneNightGap: s.extensionDiscountInHouseOneNightGap,
    discountInHouseStandard: s.extensionDiscountInHouseStandard,
    minSellableStayNights: s.minSellableStayNights,
    slackRoute: s.slackRoute,
    updatedBy: input.actorAdminId,
  };
  await db.transaction(async (tx) => {
    await tx
      .insert(propertyServiceSettings)
      .values({ tenantId: context.tenantId, propertyId: input.propertyId, ...values })
      .onConflictDoUpdate({
        target: [propertyServiceSettings.tenantId, propertyServiceSettings.propertyId],
        set: { ...values, updatedAt: new Date() },
      });
    await recordAdminAuditEvent(tx, context, {
      actorType: input.actorAdminId ? "admin" : "system",
      actorAdminId: input.actorAdminId,
      propertyId: input.propertyId,
      action: "settings.extension_updated",
      entityType: "property_settings",
      entityId: input.propertyId,
      details: { changedFields: Object.keys(values).filter((k) => k !== "updatedBy") },
    });
  });
}

/* ------------------------------------------------------------------------------------------
 * Production writer / joint go-live (M1-E: prepared, not activated)
 * ---------------------------------------------------------------------------------------- */

export type ServiceWriter = (typeof SERVICE_WRITERS)[number];
export type GoLiveState = (typeof GO_LIVE_STATES)[number];
export type ServiceWriterState = {
  serviceWriter: ServiceWriter;
  goLiveState: GoLiveState;
  changedAt: Date | null;
};

/** A tenant without a row is in the safe default: Extras writes, STAY never does. */
export async function getServiceWriterState(
  db: Database,
  context: TenantContext,
): Promise<ServiceWriterState> {
  assertTenantContext(context);
  const [row] = await db
    .select()
    .from(tenantServiceSettings)
    .where(eq(tenantServiceSettings.tenantId, context.tenantId));
  return row
    ? { serviceWriter: row.serviceWriter, goLiveState: row.goLiveState, changedAt: row.changedAt }
    : { serviceWriter: "extras", goLiveState: "extras_active", changedAt: null };
}

/**
 * Allowed go-live transitions:
 *   extras_active → syncing          (final sync of open items and settings starts)
 *   syncing       → extras_locked    (Extras locked against new bookings)
 *   syncing       → extras_active    (sync aborted)
 *   extras_locked → stay_active      (checks passed, STAY becomes the writer)
 *   extras_locked → extras_active    (go-live aborted before activation)
 *   stay_active   → extras_locked    (fallback: STAY stops writing; then → extras_active)
 */
export const GO_LIVE_TRANSITIONS: Readonly<Record<GoLiveState, readonly GoLiveState[]>> = {
  extras_active: ["syncing"],
  syncing: ["extras_locked", "extras_active"],
  extras_locked: ["stay_active", "extras_active"],
  stay_active: ["extras_locked"],
};

export function isAllowedGoLiveTransition(from: GoLiveState, to: GoLiveState): boolean {
  return GO_LIVE_TRANSITIONS[from].includes(to);
}

/**
 * The only write path for the writer state. The database trigger rejects every other change
 * (it requires `up.writer_switch = 'on'`, set here for this transaction only). Not wired to any
 * UI or CLI in M1 – activation needs the go-live approval.
 */
export async function transitionGoLiveState(
  db: Database,
  context: TenantContext,
  input: { to: GoLiveState; actorAdminId: string; now: Date; checks?: Record<string, boolean> },
): Promise<
  | { ok: true; state: ServiceWriterState }
  | { ok: false; reason: "invalid-transition" | "checks-failed" }
> {
  assertTenantContext(context);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('up.writer_switch', 'on', true)`);
    await tx
      .insert(tenantServiceSettings)
      .values({ tenantId: context.tenantId })
      .onConflictDoNothing();
    const [current] = await tx
      .select()
      .from(tenantServiceSettings)
      .where(eq(tenantServiceSettings.tenantId, context.tenantId))
      .for("update");
    const from = current?.goLiveState ?? "extras_active";
    if (!isAllowedGoLiveTransition(from, input.to))
      return { ok: false, reason: "invalid-transition" } as const;
    if (input.to === "stay_active") {
      const checks = input.checks ?? {};
      if (!Object.keys(checks).length || Object.values(checks).some((passed) => !passed)) {
        return { ok: false, reason: "checks-failed" } as const;
      }
    }
    const serviceWriter: ServiceWriter = input.to === "stay_active" ? "stay" : "extras";
    await tx
      .update(tenantServiceSettings)
      .set({
        goLiveState: input.to,
        serviceWriter,
        changedAt: input.now,
        changedBy: input.actorAdminId,
      })
      .where(eq(tenantServiceSettings.tenantId, context.tenantId));
    await recordAdminAuditEvent(tx, context, {
      actorType: "admin",
      actorAdminId: input.actorAdminId,
      action: "writer.state_changed",
      entityType: "tenant_service_settings",
      entityId: context.tenantId,
      details: { from, to: input.to, serviceWriter, checks: input.checks ?? {} },
    });
    return {
      ok: true,
      state: { serviceWriter, goLiveState: input.to, changedAt: input.now },
    } as const;
  });
}

/* ------------------------------------------------------------------------------------------
 * Apaleo write log (idempotency + lock)
 * ---------------------------------------------------------------------------------------- */

export type ApaleoWriteOperation = (typeof APALEO_WRITE_OPERATIONS)[number];
export type ApaleoWriteStatus = (typeof APALEO_WRITE_STATUSES)[number];
export type ApaleoWriteTrigger = (typeof APALEO_WRITE_TRIGGERS)[number];

export type ReserveApaleoWriteResult =
  /** This caller owns the write. `takeover`: an earlier attempt's lock expired – its outcome is
   *  unknown, so the caller must re-read Apaleo before writing again. */
  | { kind: "acquired"; id: string; takeover: boolean }
  | { kind: "in-progress"; id: string }
  | {
      kind: "done";
      id: string;
      status: Exclude<ApaleoWriteStatus, "pending">;
      resultCode: string | null;
    }
  /** Same idempotency key, different payload – never executed. */
  | { kind: "conflict"; id: string };

export async function reserveApaleoWrite(
  db: Database,
  context: TenantContext,
  input: {
    propertyId: string;
    externalReservationId: string;
    operation: ApaleoWriteOperation;
    idempotencyKey: string;
    requestHash: string;
    trigger: ApaleoWriteTrigger;
    actorAdminId?: string | null;
    now: Date;
    lockMs?: number;
  },
): Promise<ReserveApaleoWriteResult> {
  assertTenantContext(context);
  const lockedUntil = new Date(input.now.getTime() + (input.lockMs ?? 60_000));
  const [inserted] = await db
    .insert(apaleoWriteOperations)
    .values({
      tenantId: context.tenantId,
      propertyId: input.propertyId,
      externalReservationId: input.externalReservationId,
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      trigger: input.trigger,
      actorAdminId: input.actorAdminId ?? null,
      attempts: 1,
      lockedUntil,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing({
      target: [apaleoWriteOperations.tenantId, apaleoWriteOperations.idempotencyKey],
    })
    .returning({ id: apaleoWriteOperations.id });
  if (inserted) return { kind: "acquired", id: inserted.id, takeover: false };

  const [existing] = await db
    .select()
    .from(apaleoWriteOperations)
    .where(
      and(
        eq(apaleoWriteOperations.tenantId, context.tenantId),
        eq(apaleoWriteOperations.idempotencyKey, input.idempotencyKey),
      ),
    );
  if (!existing) throw new Error("Apaleo write reservation vanished");
  if (
    existing.requestHash !== input.requestHash ||
    existing.operation !== input.operation ||
    existing.propertyId !== input.propertyId ||
    existing.externalReservationId !== input.externalReservationId
  ) {
    return { kind: "conflict", id: existing.id };
  }
  if (existing.status !== "pending") {
    return {
      kind: "done",
      id: existing.id,
      status: existing.status,
      resultCode: existing.resultCode,
    };
  }
  // Pending: take over only an expired lock, atomically (one winner among parallel retries).
  const [taken] = await db
    .update(apaleoWriteOperations)
    .set({
      lockedUntil,
      attempts: sql`${apaleoWriteOperations.attempts} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(apaleoWriteOperations.id, existing.id),
        eq(apaleoWriteOperations.status, "pending"),
        // ISO string + cast: postgres.js does not serialise Date objects in raw SQL (PGlite does).
        sql`${apaleoWriteOperations.lockedUntil} <= ${input.now.toISOString()}::timestamptz`,
        sql`${apaleoWriteOperations.attempts} < 20`,
      ),
    )
    .returning({ id: apaleoWriteOperations.id });
  return taken
    ? { kind: "acquired", id: taken.id, takeover: true }
    : { kind: "in-progress", id: existing.id };
}

export async function completeApaleoWrite(
  db: Database,
  context: TenantContext,
  input: {
    id: string;
    status: Exclude<ApaleoWriteStatus, "pending">;
    resultCode?: string | null;
    httpStatus?: number | null;
    now: Date;
  },
): Promise<void> {
  assertTenantContext(context);
  await db
    .update(apaleoWriteOperations)
    .set({
      status: input.status,
      resultCode: input.resultCode ?? null,
      httpStatus: input.httpStatus ?? null,
      completedAt: input.now,
      lockedUntil: null,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(apaleoWriteOperations.tenantId, context.tenantId),
        eq(apaleoWriteOperations.id, input.id),
        eq(apaleoWriteOperations.status, "pending"),
      ),
    );
}

/* ------------------------------------------------------------------------------------------
 * Notification outbox
 * ---------------------------------------------------------------------------------------- */

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Queues a notification once per dedup key. Guest channels are queued as `suppressed` until
 * guest notifications are approved; Slack jobs stay `pending` for the (M2) worker, which only
 * sends when the channel is enabled for the environment.
 */
export async function enqueueNotification(
  db: Database,
  context: TenantContext,
  input: {
    channel: NotificationChannel;
    template: string;
    dedupKey: string;
    propertyId?: string | null;
    payload?: Record<string, unknown>;
    guestChannelsEnabled?: boolean;
  },
): Promise<{ created: boolean }> {
  assertTenantContext(context);
  const payload = input.payload ?? {};
  assertSafeAuditDetails(payload);
  const isGuestChannel = input.channel !== "slack";
  const rows = await db
    .insert(notificationOutbox)
    .values({
      tenantId: context.tenantId,
      propertyId: input.propertyId ?? null,
      channel: input.channel,
      template: input.template,
      dedupKey: input.dedupKey,
      payload,
      status: isGuestChannel && !input.guestChannelsEnabled ? "suppressed" : "pending",
    })
    .onConflictDoNothing({ target: [notificationOutbox.tenantId, notificationOutbox.dedupKey] })
    .returning({ id: notificationOutbox.id });
  return { created: rows.length > 0 };
}

/**
 * Persistence adapter for the Apaleo service write gateway (@up/integrations
 * `ServiceWriteStore`, structurally typed): writer state, reservation and completion.
 */
export function createServiceWriteStore(db: Database) {
  return {
    getServiceWriter: async (tenantId: string): Promise<ServiceWriter> =>
      (await getServiceWriterState(db, { tenantId })).serviceWriter,
    reserve: (input: Parameters<typeof reserveApaleoWrite>[2] & { tenantId: string }) =>
      reserveApaleoWrite(db, { tenantId: input.tenantId }, input),
    complete: (input: Parameters<typeof completeApaleoWrite>[2] & { tenantId: string }) =>
      completeApaleoWrite(db, { tenantId: input.tenantId }, input),
  };
}
