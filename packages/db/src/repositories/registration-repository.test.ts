import { type PropertyRegistrationConfig } from "@up/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database } from "../client";
import {
  guestRegistrationGuests,
  guestRegistrations,
  guestRegistrationSyncs,
  unitAccessCodes,
} from "../schema";
import { SAMPLE_KEYBOX_CODE, seedJourneyFixtures } from "../seed/journey-fixtures";
import { seedTenant } from "../seed/seed-tenant";
import { uniquePlacesSeed } from "../seed/unique-places";
import { createTestDatabase, expectConstraintViolation } from "../testing/test-database";
import {
  deleteUnitAccessCode,
  getJourneySettings,
  getUnitAccessCode,
  JourneySettingsError,
  saveJourneySettings,
  setUnitAccessCode,
} from "./journey-repository";
import {
  claimDueSyncs,
  completeSyncAttempt,
  getRegistrationById,
  getRegistrationForReservation,
  listRegistrationSyncs,
  purgeExpiredRegistrationData,
  saveRegistrationGuests,
  startRegistration,
  submitRegistration,
} from "./registration-repository";

let db: Database;
let close: () => Promise<void>;
const up = { tenantId: "unique-places" };
const other = { tenantId: "other-tenant" };
const now = new Date("2026-08-20T10:00:00Z");
const stay = {
  arrivalAt: new Date("2026-08-27T14:00:00Z"),
  departureAt: new Date("2026-08-31T08:00:00Z"),
};
const ciphertext = "v1.aaaa.bbbb.cccc";

let counter = 0;
function reservation(prefix = "RES") {
  counter += 1;
  return { reservationProvider: "apaleo" as const, externalReservationId: `${prefix}-${counter}` };
}

async function start(guestCount = 2, propertyId = "hov") {
  return startRegistration(db, up, {
    ...reservation(),
    propertyId,
    guestCount,
    guestCountSource: "reservation",
    ...stay,
  });
}

const laura = {
  firstName: "Laura",
  lastName: "Muster",
  birthDate: "1990-05-17",
  nationality: "DE",
};

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await seedTenant(db, uniquePlacesSeed);
  await seedTenant(db, {
    tenant: { id: "other-tenant", slug: "other-tenant", name: "Other" },
    properties: [
      {
        id: "other-hov",
        slug: "hov",
        displayName: "Other",
        spokenName: "Other",
        locationName: "Ort",
        timezone: "Europe/Berlin",
        units: [{ id: "other-unit", slug: "u", displayName: "U" }],
      },
    ],
  });
});

afterAll(async () => {
  await close();
});

describe("guest registrations", () => {
  it("creates one registration per reservation and returns it again", async () => {
    const key = reservation();
    const input = {
      ...key,
      propertyId: "hov",
      guestCount: 2,
      guestCountSource: "reservation" as const,
      ...stay,
    };
    const first = await startRegistration(db, up, input);
    const second = await startRegistration(db, up, { ...input, guestCount: 3 });
    expect(second.id).toBe(first.id);
    // A reservation-sourced count follows the PMS while it is a draft.
    expect(second.guestCount).toBe(3);
    expect(first).toMatchObject({ status: "draft", version: 1, guests: [] });
    expect(await getRegistrationForReservation(db, up, key)).toMatchObject({ id: first.id });
  });

  it("never exposes or changes a registration across tenants or properties", async () => {
    const registration = await start();
    expect(await getRegistrationById(db, other, registration.id)).toBeUndefined();
    expect(
      await getRegistrationForReservation(db, other, {
        reservationProvider: "apaleo",
        externalReservationId: registration.externalReservationId,
      }),
    ).toBeUndefined();
    expect(
      await saveRegistrationGuests(db, other, registration.id, 1, [
        { position: 0, role: "primary", data: { firstName: "X", lastName: "Y" } },
      ]),
    ).toEqual({ ok: false, reason: "not-found" });
    expect(
      await submitRegistration(db, other, registration.id, {
        expectedVersion: 1,
        targets: ["apaleo"],
        now,
      }),
    ).toEqual({ ok: false, reason: "not-found" });
    // Same reservation, other property: refused, never moved.
    await expect(
      startRegistration(db, up, {
        reservationProvider: "apaleo",
        externalReservationId: registration.externalReservationId,
        propertyId: "laeke",
        guestCount: 1,
        guestCountSource: "reservation",
        ...stay,
      }),
    ).rejects.toThrow();
    // The database refuses a guest row pointing to another tenant's registration.
    await expectConstraintViolation(
      db.insert(guestRegistrationGuests).values({
        tenantId: "other-tenant",
        registrationId: registration.id,
        position: 0,
        role: "primary",
      }),
      "guest_registration_guests_registration_fkey",
    );
  });

  it("saves drafts with optimistic concurrency and replaces whole travellers", async () => {
    const registration = await start();
    const saved = await saveRegistrationGuests(db, up, registration.id, 1, [
      { position: 0, role: "primary", data: laura },
    ]);
    expect(saved).toEqual({ ok: true, version: 2 });
    // A second tab with the old version cannot overwrite.
    expect(
      await saveRegistrationGuests(db, up, registration.id, 1, [
        { position: 0, role: "primary", data: { firstName: "Alt", lastName: "Alt" } },
      ]),
    ).toEqual({ ok: false, reason: "conflict" });
    await saveRegistrationGuests(db, up, registration.id, 2, [
      { position: 0, role: "primary", data: { firstName: "Laura", lastName: "Muster" } },
      {
        position: 1,
        role: "companion",
        data: { firstName: "Mia", lastName: "Muster", birthDate: "2015-03-01" },
      },
    ]);
    const reloaded = await getRegistrationById(db, up, registration.id);
    expect(reloaded?.guests).toEqual([
      // Removed values are cleared, not kept from before.
      { position: 0, role: "primary", data: { firstName: "Laura", lastName: "Muster" } },
      {
        position: 1,
        role: "companion",
        data: { firstName: "Mia", lastName: "Muster", birthDate: "2015-03-01" },
      },
    ]);
    expect(reloaded?.version).toBe(3);
  });

  it("submits exactly once and creates one sync per target", async () => {
    const registration = await start(1);
    await saveRegistrationGuests(db, up, registration.id, 1, [
      { position: 0, role: "primary", data: laura },
      // A leftover traveller beyond the guest count is dropped on submit.
      { position: 1, role: "companion", data: { firstName: "Alt", lastName: "Alt" } },
    ]);
    const input = { expectedVersion: 2, targets: ["apaleo", "feratel"] as const, now };
    const results = await Promise.all([
      submitRegistration(db, up, registration.id, input),
      submitRegistration(db, up, registration.id, input),
    ]);
    expect(results.filter((result) => result.ok && !result.alreadySubmitted)).toHaveLength(1);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await submitRegistration(db, up, registration.id, input)).toEqual({
      ok: true,
      alreadySubmitted: true,
    });
    const syncs = await listRegistrationSyncs(db, up, registration.id);
    expect(syncs.map((sync) => [sync.provider, sync.status, sync.attempts])).toEqual([
      ["apaleo", "pending", 0],
      ["feratel", "pending", 0],
    ]);
    const submitted = await getRegistrationById(db, up, registration.id);
    expect(submitted).toMatchObject({ status: "submitted", submittedAt: now });
    expect(submitted?.guests.map((guest) => guest.position)).toEqual([0]);
    // Submitted registrations are immutable for the guest.
    expect(
      await saveRegistrationGuests(db, up, registration.id, submitted?.version ?? 0, [
        { position: 0, role: "primary", data: { firstName: "Neu", lastName: "Neu" } },
      ]),
    ).toEqual({ ok: false, reason: "submitted" });
    // A submitted registration no longer follows PMS changes.
    const again = await startRegistration(db, up, {
      reservationProvider: "apaleo",
      externalReservationId: registration.externalReservationId,
      propertyId: "hov",
      guestCount: 4,
      guestCountSource: "reservation",
      ...stay,
    });
    expect(again.guestCount).toBe(1);
  });

  it("refuses a submit of a version the guest has not reviewed", async () => {
    const registration = await start(1);
    await saveRegistrationGuests(db, up, registration.id, 1, [
      { position: 0, role: "primary", data: laura },
    ]);
    expect(
      await submitRegistration(db, up, registration.id, { expectedVersion: 1, targets: [], now }),
    ).toEqual({ ok: false, reason: "conflict" });
  });

  it("enforces structure in the database", async () => {
    const registration = await start();
    await expectConstraintViolation(
      db.insert(guestRegistrationGuests).values({
        tenantId: "unique-places",
        registrationId: registration.id,
        position: 1,
        role: "primary",
      }),
      "guest_registration_guests_role_matches_position",
    );
    await expectConstraintViolation(
      db.insert(guestRegistrationGuests).values({
        tenantId: "unique-places",
        registrationId: registration.id,
        position: 0,
        role: "primary",
        nationality: "Deutschland",
      }),
      "guest_registration_guests_country_codes",
    );
    await expectConstraintViolation(
      db.insert(guestRegistrations).values({
        tenantId: "unique-places",
        propertyId: "hov",
        reservationProvider: "apaleo",
        externalReservationId: "X-1",
        guestCount: 13,
        guestCountSource: "reservation",
        ...stay,
      }),
      "guest_registrations_guest_count_range",
    );
    await expectConstraintViolation(
      db.insert(guestRegistrations).values({
        tenantId: "unique-places",
        propertyId: "other-hov",
        reservationProvider: "apaleo",
        externalReservationId: "X-2",
        guestCount: 1,
        guestCountSource: "reservation",
        ...stay,
      }),
      "guest_registrations_property_fkey",
    );
    await expectConstraintViolation(
      db.insert(guestRegistrationSyncs).values({
        tenantId: "unique-places",
        registrationId: registration.id,
        provider: "nuki" as never,
      }),
      "guest_registration_syncs_provider_valid",
    );
  });
});

describe("registration syncs", () => {
  async function submitted() {
    const registration = await start(1);
    await saveRegistrationGuests(db, up, registration.id, 1, [
      { position: 0, role: "primary", data: laura },
    ]);
    await submitRegistration(db, up, registration.id, {
      expectedVersion: 2,
      targets: ["apaleo", "feratel"],
      now,
    });
    return registration;
  }

  it("claims due syncs once, only for enabled providers, and records outcomes", async () => {
    await db.delete(guestRegistrationSyncs);
    const registration = await submitted();
    const claim = (at: Date) =>
      claimDueSyncs(db, { now: at, providers: ["apaleo"], limit: 10, leaseMs: 5 * 60_000 });
    const [first, ...rest] = await Promise.all([claim(now), claim(now)]).then((all) => all.flat());
    expect(rest).toEqual([]);
    expect(first).toMatchObject({ provider: "apaleo", status: "processing", attempts: 1 });
    if (!first) throw new Error("no claim");
    // Feratel (not enabled) stays pending – data waits, nothing is lost.
    const feratel = (await listRegistrationSyncs(db, up, registration.id)).find(
      (sync) => sync.provider === "feratel",
    );
    expect(feratel?.status).toBe("pending");

    const retryAt = new Date(now.getTime() + 60_000);
    expect(
      await completeSyncAttempt(db, up, first.id, {
        status: "retry_required",
        now,
        nextAttemptAt: retryAt,
        errorCode: "timeout",
      }),
    ).toBe(true);
    expect(await claim(now)).toEqual([]);
    const [retried] = await claim(retryAt);
    expect(retried?.attempts).toBe(2);
    // Another tenant cannot complete it.
    expect(await completeSyncAttempt(db, other, retried?.id ?? "", { status: "synced", now })).toBe(
      false,
    );
    expect(
      await completeSyncAttempt(db, up, retried?.id ?? "", {
        status: "synced",
        now,
        externalReference: "IHESZZFV-1",
        fingerprint: "a".repeat(64),
      }),
    ).toBe(true);
    // Completing twice (stale worker) is refused.
    expect(await completeSyncAttempt(db, up, retried?.id ?? "", { status: "failed", now })).toBe(
      false,
    );
    const apaleo = (await listRegistrationSyncs(db, up, registration.id)).find(
      (sync) => sync.provider === "apaleo",
    );
    expect(apaleo).toMatchObject({
      status: "synced",
      syncedAt: now,
      externalReference: "IHESZZFV-1",
    });
    expect(apaleo?.lastErrorCode).toBeUndefined();
  });

  it("reclaims syncs abandoned in processing after the lease", async () => {
    await db.delete(guestRegistrationSyncs);
    await submitted();
    const options = { providers: ["apaleo"] as const, limit: 10, leaseMs: 5 * 60_000 };
    expect(await claimDueSyncs(db, { ...options, now })).toHaveLength(1);
    expect(await claimDueSyncs(db, { ...options, now: new Date(now.getTime() + 60_000) })).toEqual(
      [],
    );
    const [reclaimed] = await claimDueSyncs(db, {
      ...options,
      now: new Date(now.getTime() + 6 * 60_000),
    });
    expect(reclaimed?.attempts).toBe(2);
  });
});

describe("retention", () => {
  it("purges personal data after the purge date and keeps the metadata", async () => {
    const registration = await start(1);
    await saveRegistrationGuests(db, up, registration.id, 1, [
      { position: 0, role: "primary", data: laura },
    ]);
    await submitRegistration(db, up, registration.id, {
      expectedVersion: 2,
      targets: ["apaleo"],
      now,
      purgeAfter: new Date("2026-12-01T00:00:00Z"),
    });
    expect(await purgeExpiredRegistrationData(db, new Date("2026-11-30T00:00:00Z"))).toBe(0);
    expect(
      await purgeExpiredRegistrationData(db, new Date("2026-12-01T00:00:00Z")),
    ).toBeGreaterThan(0);
    const purged = await getRegistrationById(db, up, registration.id);
    expect(purged).toMatchObject({ status: "submitted", guests: [] });
    expect(purged?.purgedAt).toEqual(new Date("2026-12-01T00:00:00Z"));
    expect(await listRegistrationSyncs(db, up, registration.id)).toHaveLength(1);
  });
});

describe("journey settings", () => {
  const registration: PropertyRegistrationConfig = {
    enabled: true,
    country: "AT",
    targets: ["apaleo", "feratel"],
    primaryGuest: { required: ["firstName", "lastName", "birthDate"], optional: [] },
    companions: { required: ["firstName", "lastName"], optional: [] },
    guestCardRelevant: true,
    providerSettings: { feratel: { destination: "beispiel" } },
  };
  const access = {
    mode: "keybox" as const,
    release: "arrival-day" as const,
    requiresCompletedRegistration: true,
  };

  it("defaults to disabled check-in and manual access", async () => {
    const settings = await getJourneySettings(db, up, "laeke");
    expect(settings).toMatchObject({
      configured: false,
      registration: { enabled: false },
      access: { mode: "manual", requiresCompletedRegistration: false },
    });
  });

  it("validates on write, reads tenant-scoped and fails closed on invalid rows", async () => {
    await saveJourneySettings(db, up, "huesle", { registration, access });
    expect(await getJourneySettings(db, up, "huesle")).toEqual({
      registration,
      access,
      configured: true,
    });
    expect((await getJourneySettings(db, other, "huesle")).configured).toBe(false);
    await expect(
      saveJourneySettings(db, up, "huesle", {
        registration: { ...registration, targets: ["nuki"] },
        access,
      }),
    ).rejects.toThrow();
    await expect(
      saveJourneySettings(db, other, "huesle", { registration, access }),
    ).rejects.toThrow();
    // Simulate a hand-edited, invalid row.
    await db.execute(
      sql`UPDATE property_journey_settings SET access = '{"mode":"door"}' WHERE property_id = 'huesle'`,
    );
    await expect(getJourneySettings(db, up, "huesle")).rejects.toThrow(JourneySettingsError);
  });
});

describe("unit access codes", () => {
  it("stores only ciphertext per unit and never across tenants", async () => {
    const key = { propertyId: "hov", unitId: "ros" };
    await setUnitAccessCode(db, up, key, ciphertext);
    expect(await getUnitAccessCode(db, up, key)).toMatchObject({ codeCiphertext: ciphertext });
    expect(await getUnitAccessCode(db, other, key)).toBeUndefined();
    expect(await deleteUnitAccessCode(db, other, key)).toBe(false);
    // A unit of another property, or another tenant's unit, is refused by the database.
    await expect(
      setUnitAccessCode(db, up, { propertyId: "laeke", unitId: "ros" }, ciphertext),
    ).rejects.toThrow();
    await expect(
      setUnitAccessCode(db, up, { propertyId: "other-hov", unitId: "other-unit" }, ciphertext),
    ).rejects.toThrow();
    await expectConstraintViolation(
      db.insert(unitAccessCodes).values({
        tenantId: "unique-places",
        propertyId: "hov",
        unitId: "khu",
        codeCiphertext: "4711",
      }),
      "unit_access_codes_ciphertext_format",
    );
    expect(await deleteUnitAccessCode(db, up, key)).toBe(true);
  });
});

describe("journey fixtures (local only)", () => {
  it("configures the sample property and encrypts the sample code", async () => {
    const fixtures = await createTestDatabase();
    try {
      await seedTenant(fixtures.db, uniquePlacesSeed);
      const key = Buffer.alloc(32, 3).toString("base64");
      expect(await seedJourneyFixtures(fixtures.db, up, { accessCodeKey: key })).toEqual({
        properties: 1,
        codes: 1,
      });
      expect((await getJourneySettings(fixtures.db, up, "hov")).registration.enabled).toBe(true);
      const stored = await getUnitAccessCode(fixtures.db, up, { propertyId: "hov", unitId: "ros" });
      expect(stored?.codeCiphertext).not.toContain(SAMPLE_KEYBOX_CODE);
    } finally {
      await fixtures.close();
    }
  }, 60_000);
});
