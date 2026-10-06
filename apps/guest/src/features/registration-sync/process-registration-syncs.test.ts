import { createLogger, type GuestRegistrationProvider, type SyncOutcome } from "@up/core";
import {
  type Database,
  getRegistrationForReservation,
  listRegistrationSyncs,
  purgeExpiredRegistrationData,
  saveJourneySettings,
  seedTenant,
  uniquePlacesSeed,
} from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { confirmTrip, saveGuestStep, submitCheckIn } from "../check-in/check-in-service";
import { BEFORE_ARRIVAL, guestContext, testRegistrationConfig } from "../check-in/test-context";
import { processRegistrationSyncs } from "./process-registration-syncs";

let test: TestDatabase;
let db: Database;
const lines: string[] = [];
const logger = createLogger({ level: "debug", sink: (_level, line) => lines.push(line) });
const up = { tenantId: "unique-places" };
let clock = BEFORE_ARRIVAL;
const now = () => clock;

beforeEach(async () => {
  lines.length = 0;
  clock = BEFORE_ARRIVAL;
  test = await createTestDatabase();
  db = test.db;
  await seedTenant(db, uniquePlacesSeed);
  await saveJourneySettings(db, up, "hov", {
    registration: { ...testRegistrationConfig, providerSettings: { apaleo: { note: "x" } } },
    access: { mode: "manual", release: "arrival-day", requiresCompletedRegistration: false },
  });
  const context = guestContext({ guestCount: { adults: 1, children: 0 } });
  const deps = { db, logger, now };
  await confirmTrip(deps, context, {});
  await saveGuestStep(deps, context, {
    step: "primary",
    version: 1,
    values: {
      0: { firstName: "Laura", lastName: "Muster", birthDate: "1990-05-17", nationality: "DE" },
    },
  });
  await saveGuestStep(deps, context, {
    step: "address",
    version: 2,
    values: { 0: { street: "Seeweg 3", postalCode: "88131", city: "Lindau", country: "DE" } },
  });
  await submitCheckIn(deps, context, { version: 3, confirmed: true });
});

afterEach(async () => {
  await test.close();
});

function fake(outcomes: (SyncOutcome | Error)[]) {
  const submit = vi.fn(() => {
    const next = outcomes.shift() ?? { status: "synced" };
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  const provider: GuestRegistrationProvider = { target: "apaleo", submit };
  return Object.assign(provider, { spy: submit });
}

async function syncs() {
  const registration = await getRegistrationForReservation(db, up, {
    reservationProvider: "apaleo",
    externalReservationId: "ABCDEFGH-1",
  });
  return { registration, syncs: await listRegistrationSyncs(db, up, registration?.id ?? "") };
}

describe("registration sync worker", () => {
  it("hands the canonical data to the provider and records success", async () => {
    const apaleo = fake([
      { status: "synced", externalReference: "ABCDEFGH-1", fingerprint: "b".repeat(64) },
    ]);
    expect(await processRegistrationSyncs({ db, logger, now, providers: { apaleo } })).toEqual({
      claimed: 1,
      synced: 1,
      retry: 0,
      failed: 0,
    });
    const [submission, memory] = apaleo.spy.mock.calls[0] as unknown as [
      Record<string, unknown>,
      unknown,
    ];
    expect(submission).toMatchObject({
      tenantId: "unique-places",
      propertyId: "hov",
      reservation: { provider: "apaleo", externalReservationId: "ABCDEFGH-1" },
      settings: { note: "x" },
      guests: [{ position: 0, role: "primary", data: { firstName: "Laura", city: "Lindau" } }],
    });
    expect(memory).toEqual({});
    const state = await syncs();
    expect(state.syncs.find((sync) => sync.provider === "apaleo")).toMatchObject({
      status: "synced",
      externalReference: "ABCDEFGH-1",
    });
    // Feratel is not implemented: its sync waits, untouched.
    expect(state.syncs.find((sync) => sync.provider === "feratel")).toMatchObject({
      status: "pending",
      attempts: 0,
    });
    // Nothing more to do.
    expect(
      (await processRegistrationSyncs({ db, logger, now, providers: { apaleo } })).claimed,
    ).toBe(0);
  });

  it("retries temporary failures with backoff and never loses the registration", async () => {
    const apaleo = fake([
      { status: "retry", code: "timeout" },
      new Error("boom"),
      { status: "synced" },
    ]);
    const deps = { db, logger, now, providers: { apaleo } };
    expect((await processRegistrationSyncs(deps)).retry).toBe(1);
    let apaleoSync = (await syncs()).syncs.find((sync) => sync.provider === "apaleo");
    expect(apaleoSync).toMatchObject({
      status: "retry_required",
      lastErrorCode: "timeout",
      attempts: 1,
    });
    // Not due yet.
    expect((await processRegistrationSyncs(deps)).claimed).toBe(0);
    clock = new Date(BEFORE_ARRIVAL.getTime() + 61_000);
    expect((await processRegistrationSyncs(deps)).retry).toBe(1); // crash → retry
    clock = new Date(BEFORE_ARRIVAL.getTime() + 10 * 60_000);
    expect((await processRegistrationSyncs(deps)).synced).toBe(1);
    const state = await syncs();
    apaleoSync = state.syncs.find((sync) => sync.provider === "apaleo");
    expect(apaleoSync).toMatchObject({ status: "synced", attempts: 3 });
    expect(apaleoSync?.lastErrorCode).toBeUndefined();
    // The canonical registration is unchanged by all of this.
    expect(state.registration).toMatchObject({ status: "submitted" });
    expect(state.registration?.guests[0]?.data.lastName).toBe("Muster");
  });

  it("marks permanent failures for a human and logs codes only", async () => {
    const apaleo = fake([{ status: "failed", code: "conflict" }]);
    expect(
      (await processRegistrationSyncs({ db, logger, now, providers: { apaleo } })).failed,
    ).toBe(1);
    expect((await syncs()).syncs.find((sync) => sync.provider === "apaleo")).toMatchObject({
      status: "failed",
      lastErrorCode: "conflict",
    });
    const log = lines.join("\n");
    expect(log).toContain('"code":"conflict"');
    for (const value of ["Laura", "Muster", "Seeweg", "1990-05-17"])
      expect(log).not.toContain(value);
  });

  it("does not send purged registrations", async () => {
    const { registration } = await syncs();
    expect(registration?.purgeAfter).toBeDefined();
    await purgeExpiredRegistrationData(db, new Date("2027-12-31T00:00:00Z"));
    const apaleo = fake([]);
    expect(
      (await processRegistrationSyncs({ db, logger, now, providers: { apaleo } })).failed,
    ).toBe(1);
    expect(apaleo.spy).not.toHaveBeenCalled();
  });

  it("does nothing without enabled providers", async () => {
    expect(await processRegistrationSyncs({ db, logger, now, providers: {} })).toEqual({
      claimed: 0,
      synced: 0,
      retry: 0,
      failed: 0,
    });
  });
});
