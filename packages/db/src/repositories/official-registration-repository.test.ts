import { createHash } from "node:crypto";

import {
  buildOfficialPayload,
  createLogger,
  OFFICIAL_OPERATIONS,
  type OfficialOperation,
  type OfficialRegistrationProvider,
  type OfficialRegistrationSettings,
  type ProviderCapabilities,
  type ProviderOutcome,
  requestRetry,
  runOfficialRegistration,
} from "@up/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database } from "../client";
import {
  adminUsers,
  officialGuestCards,
  officialRegistrationEvents,
  officialRegistrations,
  officialRegistrationSettings,
  properties,
  tenants,
} from "../schema";
import {
  createTestDatabase,
  expectConstraintViolation,
  type TestDatabase,
} from "../testing/test-database";
import {
  claimDueOfficialRegistrations,
  ensureOfficialRegistration,
  getOfficialRegistration,
  getOfficialRegistrationSettings,
  listOfficialRegistrationEvents,
  listOfficialRegistrations,
  type OfficialRegistrationRecord,
  purgeOfficialRegistrationData,
  saveOfficialRegistrationSettings,
  saveOfficialRegistrationState,
} from "./official-registration-repository";
import {
  saveRegistrationGuests,
  startRegistration,
  submitRegistration,
} from "./registration-repository";

/** Drizzle wraps driver errors – match the message anywhere in the cause chain. */
async function expectRejected(query: PromiseLike<unknown>, pattern: RegExp): Promise<void> {
  let caught: unknown;
  try {
    await query;
  } catch (error) {
    caught = error;
  }
  const messages: string[] = [];
  for (let current = caught; current instanceof Error; current = current.cause) {
    messages.push(current.message);
  }
  expect(messages.join(" | ")).toMatch(pattern);
}

let db: Database;
let client: TestDatabase["client"];
let close: () => Promise<void>;
const A = { tenantId: "tenant-a" };
const B = { tenantId: "tenant-b" };
const NOW = new Date("2026-12-01T09:00:00Z");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

const SETTINGS: OfficialRegistrationSettings = {
  target: "feratel",
  enabled: true,
  environment: "simulated",
  bindingRegistration: { rule: "arrival-day" },
  allowedOperations: ["create-pre-registration", "convert-to-registration", "check-out"],
  guestCards: true,
  childUnderAge: 15,
  providerSettings: { mappingCode: "SIM-123" },
  eventRetentionDays: 400,
};

let counter = 0;
async function submittedRegistration(context = A, propertyId = "prop-a") {
  counter += 1;
  const registration = await startRegistration(db, context, {
    reservationProvider: "apaleo",
    externalReservationId: `RES-${counter}`,
    propertyId,
    guestCount: 1,
    guestCountSource: "reservation",
    arrivalAt: new Date("2026-12-20T15:00:00Z"),
    departureAt: new Date("2026-12-27T09:00:00Z"),
  });
  const saved = await saveRegistrationGuests(db, context, registration.id, registration.version, [
    { position: 0, role: "primary", data: { firstName: "Lea", lastName: "Beispiel" } },
  ]);
  if (!saved.ok) throw new Error("save failed");
  const submitted = await submitRegistration(db, context, registration.id, {
    expectedVersion: saved.version,
    targets: [],
    now: NOW,
  });
  if (!submitted.ok) throw new Error("submit failed");
  return { id: registration.id, externalReservationId: `RES-${counter}`, propertyId };
}

async function ensured(context = A, propertyId = "prop-a"): Promise<OfficialRegistrationRecord> {
  const registration = await submittedRegistration(context, propertyId);
  const result = await ensureOfficialRegistration(db, context, {
    registrationId: registration.id,
    target: "feratel",
    now: NOW,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.record;
}

beforeAll(async () => {
  ({ db, client, close } = await createTestDatabase());
  await db.insert(tenants).values([
    { id: "tenant-a", slug: "tenant-a", name: "Tenant A" },
    { id: "tenant-b", slug: "tenant-b", name: "Tenant B" },
  ]);
  const property = {
    displayName: "P",
    spokenName: "P",
    locationName: "Ort",
    timezone: "Europe/Vienna",
  };
  await db.insert(properties).values([
    { ...property, id: "prop-a", tenantId: "tenant-a", slug: "a" },
    { ...property, id: "prop-a2", tenantId: "tenant-a", slug: "a2" },
    { ...property, id: "prop-b", tenantId: "tenant-b", slug: "b" },
  ]);
  await saveOfficialRegistrationSettings(db, A, "prop-a", SETTINGS);
  await saveOfficialRegistrationSettings(db, A, "prop-a2", {
    ...SETTINGS,
    enabled: false,
    guestCards: false,
  });
  await saveOfficialRegistrationSettings(db, B, "prop-b", SETTINGS);
});

afterAll(async () => {
  await close();
});

describe("security", () => {
  it("RLS is on for all new tables", async () => {
    const result = await client.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'official_%' AND relkind = 'r' ORDER BY relname`,
    );
    expect(result.rows.map((row) => row.relname)).toEqual([
      "official_guest_cards",
      "official_registration_events",
      "official_registration_settings",
      "official_registrations",
    ]);
    expect(result.rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  it("no table has a column for names, contact or address data", async () => {
    const result = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'official_%'`,
    );
    const columns = result.rows.map((row) => row.column_name).join(" ");
    for (const forbidden of [
      "name",
      "email",
      "phone",
      "street",
      "birth",
      "nationality",
      "document",
      "address",
      "note",
      "message",
      "payload",
    ]) {
      expect(columns).not.toMatch(new RegExp(`(^|_| )${forbidden}`));
    }
  });
});

describe("settings", () => {
  it("round-trips and is tenant-scoped", async () => {
    expect(await getOfficialRegistrationSettings(db, A, "prop-a", "feratel")).toEqual(SETTINGS);
    expect(await getOfficialRegistrationSettings(db, B, "prop-a", "feratel")).toBeUndefined();
  });

  it("binding registration timing and confirmed operations are data", async () => {
    await saveOfficialRegistrationSettings(db, A, "prop-a2", {
      ...SETTINGS,
      enabled: false,
      bindingRegistration: { rule: "days-before-arrival", days: 3 },
      preRegistrationLeadDays: 30,
      allowedOperations: ["update-departure"],
    });
    expect(await getOfficialRegistrationSettings(db, A, "prop-a2", "feratel")).toMatchObject({
      bindingRegistration: { rule: "days-before-arrival", days: 3 },
      preRegistrationLeadDays: 30,
      allowedOperations: ["update-departure"],
    });
    await saveOfficialRegistrationSettings(db, A, "prop-a2", {
      ...SETTINGS,
      enabled: false,
      guestCards: false,
    });
  });

  it("live guard: test/production cannot be enabled (database CHECK)", async () => {
    await expectConstraintViolation(
      db
        .update(officialRegistrationSettings)
        .set({ environment: "production" })
        .where(sql`${officialRegistrationSettings.propertyId} = 'prop-a'`),
      "official_registration_settings_live_guard",
    );
    await expect(
      saveOfficialRegistrationSettings(db, A, "prop-a", { ...SETTINGS, environment: "test" }),
    ).rejects.toThrow();
  });

  it("rejects secrets, unknown operations and broken timing", async () => {
    await expectRejected(
      db
        .update(officialRegistrationSettings)
        .set({ providerSettings: { apiToken: "x" } })
        .where(sql`${officialRegistrationSettings.propertyId} = 'prop-a2'`),
      /non-secret/,
    );
    await expectConstraintViolation(
      db
        .update(officialRegistrationSettings)
        .set({ allowedOperations: ["delete-everything"] })
        .where(sql`${officialRegistrationSettings.propertyId} = 'prop-a2'`),
      "official_registration_settings_operations_known",
    );
    await expectConstraintViolation(
      db
        .update(officialRegistrationSettings)
        .set({ bindingRegistrationRule: "days-before-arrival" })
        .where(sql`${officialRegistrationSettings.propertyId} = 'prop-a2'`),
      "official_registration_settings_rule_days",
    );
  });
});

describe("state rows and duplicate guards", () => {
  it("ensure: needs a submitted check-in and settings; created exactly once", async () => {
    expect(
      await ensureOfficialRegistration(db, A, {
        registrationId: "not-a-uuid",
        target: "feratel",
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      reason: "registration-not-found",
    });
    const draft = await startRegistration(db, A, {
      reservationProvider: "apaleo",
      externalReservationId: "DRAFT-1",
      propertyId: "prop-a",
      guestCount: 1,
      guestCountSource: "reservation",
      arrivalAt: new Date("2026-12-20T15:00:00Z"),
      departureAt: new Date("2026-12-27T09:00:00Z"),
    });
    expect(
      await ensureOfficialRegistration(db, A, {
        registrationId: draft.id,
        target: "feratel",
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      reason: "not-submitted",
    });

    const registration = await submittedRegistration();
    const first = await ensureOfficialRegistration(db, A, {
      registrationId: registration.id,
      target: "feratel",
      now: NOW,
    });
    const second = await ensureOfficialRegistration(db, A, {
      registrationId: registration.id,
      target: "feratel",
      now: NOW,
    });
    expect(first).toMatchObject({ ok: true, created: true });
    expect(second).toMatchObject({ ok: true, created: false });
    expect(first.ok && first.record).toMatchObject({
      propertyId: "prop-a",
      externalReservationId: registration.externalReservationId,
      ourReference: `up-${registration.id}`,
      stage: "none",
      transmission: "pending",
      guestCard: { status: "waiting" },
    });
    const rows = await db
      .select()
      .from(officialRegistrations)
      .where(sql`${officialRegistrations.registrationId} = ${registration.id}`);
    expect(rows).toHaveLength(1);
  });

  it("guest card row: not-applicable where the property issues none", async () => {
    const record = await ensured(A, "prop-a2");
    expect(record.guestCard.status).toBe("not-applicable");
  });

  it("tenant isolation: another tenant neither sees nor creates", async () => {
    const registration = await submittedRegistration(A);
    expect(
      await ensureOfficialRegistration(db, B, {
        registrationId: registration.id,
        target: "feratel",
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      reason: "registration-not-found",
    });
    await ensureOfficialRegistration(db, A, {
      registrationId: registration.id,
      target: "feratel",
      now: NOW,
    });
    expect(await getOfficialRegistration(db, B, registration.id, "feratel")).toBeUndefined();
    expect(await listOfficialRegistrations(db, B, "prop-a", "feratel")).toEqual([]);
  });

  it("database binds the row to its check-in, property and reservation", async () => {
    const registration = await submittedRegistration();
    const base = {
      tenantId: "tenant-a",
      propertyId: "prop-a",
      target: "feratel" as const,
      registrationId: registration.id,
      reservationProvider: "apaleo" as const,
      externalReservationId: registration.externalReservationId,
      ourReference: `up-${registration.id}`,
    };
    await expectRejected(
      db.insert(officialRegistrations).values({ ...base, externalReservationId: "OTHER" }),
      /does not match its check-in/,
    );
    await expectRejected(
      db.insert(officialRegistrations).values({ ...base, propertyId: "prop-a2" }),
      /does not match its check-in/,
    );
    await expectConstraintViolation(
      db.insert(officialRegistrations).values({ ...base, ourReference: "up-something-else" }),
      "official_registrations_our_reference_format",
    );
    // Cross-tenant: tenant B cannot point at tenant A's check-in (trigger + composite FK).
    await expectRejected(
      db
        .insert(officialRegistrations)
        .values({ ...base, tenantId: "tenant-b", propertyId: "prop-b" }),
      /does not match its check-in|official_registrations_registration_fkey/,
    );
    await db.insert(officialRegistrations).values(base);
    await expectConstraintViolation(
      db.insert(officialRegistrations).values(base),
      "official_registrations_registration_key",
    );
  });

  it("identity is immutable and the target reference is write-once", async () => {
    const record = await ensured();
    const where = sql`${officialRegistrations.id} = ${record.id}`;
    await expectRejected(
      db.update(officialRegistrations).set({ externalReservationId: "X" }).where(where),
      /immutable/,
    );
    await expectRejected(
      db.update(officialRegistrations).set({ propertyId: "prop-a2" }).where(where),
      /immutable/,
    );
    await db.update(officialRegistrations).set({ externalReference: "SIM-REF-1" }).where(where);
    await expectRejected(
      db.update(officialRegistrations).set({ externalReference: "SIM-REF-2" }).where(where),
      /write-once/,
    );
    await expectRejected(
      db.update(officialRegistrations).set({ externalReference: null }).where(where),
      /write-once/,
    );
    // the same reference cannot be used by a second registration
    const other = await ensured();
    await expectConstraintViolation(
      db
        .update(officialRegistrations)
        .set({ externalReference: "SIM-REF-1" })
        .where(sql`${officialRegistrations.id} = ${other.id}`),
      "official_registrations_external_reference_key",
    );
  });

  it("consistency checks: confirmed needs a reference, staff states need a reason", async () => {
    const record = await ensured();
    const where = sql`${officialRegistrations.id} = ${record.id}`;
    await expectConstraintViolation(
      db.update(officialRegistrations).set({ transmission: "confirmed" }).where(where),
      "official_registrations_confirmed_has_reference",
    );
    await expectConstraintViolation(
      db.update(officialRegistrations).set({ transmission: "manual" }).where(where),
      "official_registrations_staff_reason",
    );
    await expectConstraintViolation(
      db.update(officialRegistrations).set({ unresolvedOperation: "check-out" }).where(where),
      "official_registrations_unresolved_consistent",
    );
  });

  it("rows cannot be deleted outside the retention purge", async () => {
    const record = await ensured();
    await expectRejected(
      db.delete(officialRegistrations).where(sql`${officialRegistrations.id} = ${record.id}`),
      /retention purge/,
    );
    await expectRejected(
      db
        .delete(officialGuestCards)
        .where(sql`${officialGuestCards.officialRegistrationId} = ${record.id}`),
      /due registration/,
    );
  });

  it("existing check-in deletion is blocked while an official state exists (no lost duplicate guard)", async () => {
    const record = await ensured();
    await expectRejected(
      db.execute(sql`DELETE FROM guest_registrations WHERE id = ${record.registrationId}`),
      /official_registrations_registration_fkey|violates foreign key/,
    );
  });
});

describe("protocol", () => {
  const ALL: ProviderCapabilities = {
    ...(Object.fromEntries(OFFICIAL_OPERATIONS.map((op) => [op, true])) as Record<
      OfficialOperation,
      boolean
    >),
    idempotentWrites: true,
    guestCardStatus: false,
  };
  const provider = (answers: ProviderOutcome[]): OfficialRegistrationProvider => ({
    target: "feratel",
    environment: "simulated",
    capabilities: ALL,
    execute: () =>
      Promise.resolve(answers.shift() ?? { kind: "ok", externalReference: `SIM-${Math.random()}` }),
  });

  async function runOnce(
    record: OfficialRegistrationRecord,
    answers: ProviderOutcome[],
    today = "2026-12-01",
  ) {
    const stay = {
      status: "confirmed" as const,
      arrivalDate: "2026-12-20",
      departureDate: "2026-12-27",
    };
    const payload = buildOfficialPayload({
      registrationId: record.registrationId,
      stay,
      guests: [],
      guestCount: 1,
      childUnderAge: 15,
      confirmedPrimaryEmail: "lea@example.org",
    });
    const result = await runOfficialRegistration(
      {
        provider: provider(answers),
        now: () => NOW,
        logger: createLogger({ sink: () => undefined }),
      },
      {
        state: record,
        payload,
        stay,
        gate: { open: true },
        today,
        registrationDay: stay.arrivalDate,
      },
    );
    const saved = await saveOfficialRegistrationState(db, A, {
      record,
      next: result.state,
      log: result.log,
      now: NOW,
      eventPurgeAfter: new Date(NOW.getTime() + 400 * 86_400_000),
    });
    return { result, saved };
  }

  it("a simulated run is persisted atomically with its protocol entry and card status", async () => {
    const record = await ensured();
    const { saved } = await runOnce(record, [{ kind: "ok", externalReference: "SIM-P1" }]);
    expect(saved).toEqual({ ok: true, version: 2 });
    const stored = await getOfficialRegistration(db, A, record.registrationId, "feratel");
    expect(stored).toMatchObject({
      stage: "pre-registered",
      transmission: "confirmed",
      externalReference: "SIM-P1",
      guestCard: { status: "requested" },
    });
    const events = await listOfficialRegistrationEvents(db, A, record.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      operation: "create-pre-registration",
      result: "ok",
      actor: "system",
      stageAfter: "pre-registered",
      guestCardAfter: "requested",
    });
    expect(events[0]?.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("optimistic concurrency: a stale writer is rejected and writes nothing", async () => {
    const record = await ensured();
    await runOnce(record, [{ kind: "temporary", code: "unavailable" }]);
    const stale = await runOnce(record, [{ kind: "ok", externalReference: "SIM-STALE" }]);
    expect(stale.saved).toEqual({ ok: false, reason: "conflict" });
    expect(await listOfficialRegistrationEvents(db, A, record.id)).toHaveLength(1);
  });

  it("staff action is logged with the admin id", async () => {
    const record = await ensured();
    await runOnce(record, [{ kind: "rejected", code: "invalid_data" }]);
    const failed = await getOfficialRegistration(db, A, record.registrationId, "feratel");
    if (!failed) throw new Error("missing");
    expect(failed).toMatchObject({ transmission: "failed", manualReason: "rejected" });
    const [admin] = await db
      .insert(adminUsers)
      .values({
        tenantId: "tenant-a",
        email: `a${counter}@example.org`,
        passwordHash: "scrypt$test",
      })
      .returning({ id: adminUsers.id });
    const adminId = admin?.id ?? "";
    const retry = requestRetry(failed, adminId, NOW);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(
      await saveOfficialRegistrationState(db, A, {
        record: failed,
        next: retry.state,
        log: [retry.log],
        now: NOW,
      }),
    ).toMatchObject({ ok: true });
    const events = await listOfficialRegistrationEvents(db, A, record.id);
    expect(events.at(-1)).toMatchObject({
      operation: "admin-retry",
      actor: "admin",
      adminUserId: adminId,
    });
  });

  it("the protocol is append-only", async () => {
    const record = await ensured();
    await runOnce(record, [{ kind: "ok", externalReference: "SIM-AO" }]);
    const where = sql`${officialRegistrationEvents.officialRegistrationId} = ${record.id}`;
    await expectRejected(
      db.update(officialRegistrationEvents).set({ result: "rejected" }).where(where),
      /append-only/,
    );
    await expectRejected(db.delete(officialRegistrationEvents).where(where), /retention purge/);
    await expectRejected(db.execute(sql`TRUNCATE official_registration_events`), /append-only/);
  });

  it("protocol entries must match their registration and actors", async () => {
    const record = await ensured();
    const entry = {
      tenantId: "tenant-a",
      propertyId: "prop-a2",
      target: "feratel" as const,
      officialRegistrationId: record.id,
      operation: "create-registration" as const,
      result: "ok" as const,
      actor: "system" as const,
      stageAfter: "registered" as const,
      transmissionAfter: "confirmed" as const,
      occurredAt: NOW,
    };
    await expectRejected(
      db.insert(officialRegistrationEvents).values(entry),
      /does not match its registration/,
    );
    await expectConstraintViolation(
      db
        .insert(officialRegistrationEvents)
        .values({ ...entry, propertyId: "prop-a", actor: "admin" }),
      "official_registration_events_admin_consistent",
    );
  });

  it("a creating operation with the same idempotency key succeeds only once (database)", async () => {
    const record = await ensured();
    const entry = {
      tenantId: "tenant-a",
      propertyId: "prop-a",
      target: "feratel" as const,
      officialRegistrationId: record.id,
      operation: "create-registration" as const,
      result: "ok" as const,
      actor: "system" as const,
      idempotencyKey: sha(`dup-${record.id}`),
      stageAfter: "registered" as const,
      transmissionAfter: "confirmed" as const,
      occurredAt: NOW,
    };
    await db.insert(officialRegistrationEvents).values(entry);
    await expectConstraintViolation(
      db.insert(officialRegistrationEvents).values(entry),
      "official_registration_events_one_successful_create",
    );
    // failed attempts with the same key are fine (retries)
    await db
      .insert(officialRegistrationEvents)
      .values({ ...entry, result: "temporary", code: "unavailable" });
  });
});

describe("worker claim", () => {
  it("claims only rows of enabled properties, with a lease, and never twice", async () => {
    const enabled = await ensured(A, "prop-a");
    const disabled = await ensured(A, "prop-a2");
    const first = await claimDueOfficialRegistrations(db, {
      now: NOW,
      target: "feratel",
      limit: 100,
      leaseMs: 60_000,
    });
    const ids = first.map((row) => row.id);
    expect(ids).toContain(enabled.id);
    expect(ids).not.toContain(disabled.id);
    const second = await claimDueOfficialRegistrations(db, {
      now: NOW,
      target: "feratel",
      limit: 100,
      leaseMs: 60_000,
    });
    expect(second.map((row) => row.id)).not.toContain(enabled.id);
    const later = await claimDueOfficialRegistrations(db, {
      now: new Date(NOW.getTime() + 61_000),
      target: "feratel",
      limit: 100,
      leaseMs: 60_000,
    });
    expect(later.map((row) => row.id)).toContain(enabled.id);
  });

  it("skips rows waiting for staff", async () => {
    const record = await ensured();
    await db
      .update(officialRegistrations)
      .set({ transmission: "manual", manualReason: "not-supported" })
      .where(sql`${officialRegistrations.id} = ${record.id}`);
    const claimed = await claimDueOfficialRegistrations(db, {
      now: new Date(NOW.getTime() + 3_600_000),
      target: "feratel",
      limit: 100,
      leaseMs: 60_000,
    });
    expect(claimed.map((row) => row.id)).not.toContain(record.id);
  });
});

describe("retention purge", () => {
  it("removes only due protocol entries and due states without protocol", async () => {
    const keep = await ensured();
    const due = await ensured();
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 86_400_000);
    const event = (id: string, purgeAfter: Date) => ({
      tenantId: "tenant-a",
      propertyId: "prop-a",
      target: "feratel" as const,
      officialRegistrationId: id,
      operation: "check-out" as const,
      result: "ok" as const,
      actor: "system" as const,
      stageAfter: "checked-out" as const,
      transmissionAfter: "pending" as const,
      occurredAt: NOW,
      purgeAfter,
    });
    await db
      .insert(officialRegistrationEvents)
      .values([event(keep.id, future), event(due.id, past)]);
    await db
      .update(officialRegistrations)
      .set({ purgeAfter: past })
      .where(sql`${officialRegistrations.id} = ${due.id}`);
    await db
      .update(officialRegistrations)
      .set({ purgeAfter: future })
      .where(sql`${officialRegistrations.id} = ${keep.id}`);

    const result = await purgeOfficialRegistrationData(db, new Date());
    expect(result.events).toBeGreaterThanOrEqual(1);
    expect(result.registrations).toBeGreaterThanOrEqual(1);
    expect(await getOfficialRegistration(db, A, due.registrationId, "feratel")).toBeUndefined();
    expect(await getOfficialRegistration(db, A, keep.registrationId, "feratel")).toBeDefined();
    expect(await listOfficialRegistrationEvents(db, A, keep.id)).toHaveLength(1);
  });

  it("without the purge switch even due rows stay", async () => {
    const record = await ensured();
    const past = new Date(Date.now() - 86_400_000);
    await db
      .update(officialRegistrations)
      .set({ purgeAfter: past })
      .where(sql`${officialRegistrations.id} = ${record.id}`);
    await expectRejected(
      db.delete(officialRegistrations).where(sql`${officialRegistrations.id} = ${record.id}`),
      /retention purge/,
    );
  });
});
