import {
  type Database,
  getRegistrationForReservation,
  listRegistrationSyncs,
  saveJourneySettings,
  seedTenant,
  uniquePlacesSeed,
} from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CHECK_IN_RATE_LIMIT,
  checkInAvailability,
  type CheckInDeps,
  confirmTrip,
  saveGuestStep,
  submitCheckIn,
} from "./check-in-service";
import { buildStepForm } from "./form-model";
import {
  BEFORE_ARRIVAL,
  capturingLogger,
  guestContext,
  testRegistrationConfig,
} from "./test-context";

let test: TestDatabase;
let db: Database;
let deps: CheckInDeps;
let lines: string[];
const up = { tenantId: "unique-places" };
const access = {
  mode: "manual" as const,
  release: "arrival-day" as const,
  requiresCompletedRegistration: false,
};

const laura = {
  firstName: "Laura",
  lastName: "Muster",
  birthDate: "1990-05-17",
  nationality: "DE",
};
const address = { street: "Seeweg 3", postalCode: "88131", city: "Lindau", country: "DE" };

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  await seedTenant(db, uniquePlacesSeed);
  await saveJourneySettings(db, up, "hov", { registration: testRegistrationConfig, access });
  const captured = capturingLogger();
  lines = captured.lines;
  deps = { db, logger: captured.logger, now: () => BEFORE_ARRIVAL };
});

afterEach(async () => {
  await test.close();
});

async function registration(context = guestContext()) {
  return getRegistrationForReservation(db, context, {
    reservationProvider: context.reservationProvider,
    externalReservationId: context.externalReservationId,
  });
}

describe("availability", () => {
  it("is off without database, settings, loaded reservation or after the stay", async () => {
    expect(await checkInAvailability({ ...deps, db: undefined }, guestContext())).toMatchObject({
      available: false,
      reason: "no-database",
    });
    expect(await checkInAvailability(deps, guestContext({ propertyId: "laeke" }))).toMatchObject({
      available: false,
      reason: "not-enabled",
    });
    expect(
      await checkInAvailability(deps, guestContext({ reservation: { status: "unavailable" } })),
    ).toMatchObject({ available: false, reason: "reservation-unavailable" });
    expect(
      await checkInAvailability(deps, guestContext({ now: new Date("2026-08-31T10:00:00+02:00") })),
    ).toMatchObject({ available: false, reason: "stay-over" });
    // Another tenant's guest never gets this tenant's settings.
    expect(
      await checkInAvailability(deps, guestContext({ tenantId: "other-tenant" })),
    ).toMatchObject({
      available: false,
    });
    expect((await checkInAvailability(deps, guestContext())).available).toBe(true);
  });
});

describe("check-in flow", () => {
  it("runs trip → primary → companions → address → submit and creates syncs once", async () => {
    const context = guestContext();
    expect(await confirmTrip(deps, context, {})).toEqual({ ok: true });
    let current = await registration();
    expect(current).toMatchObject({ guestCount: 2, guestCountSource: "reservation", version: 1 });

    // Invalid value: nothing saved, the error names the field only.
    const invalid = await saveGuestStep(deps, context, {
      step: "primary",
      version: 1,
      values: { 0: { ...laura, birthDate: "2031-01-01" } },
    });
    expect(invalid).toEqual({
      ok: false,
      reason: "invalid",
      errors: { 0: [{ field: "birthDate", code: "invalid" }] },
    });
    expect((await registration())?.guests).toEqual([]);

    // Missing fields: valid values are kept (progress), the guest is told what is missing.
    const partial = await saveGuestStep(deps, context, {
      step: "primary",
      version: 1,
      values: { 0: { firstName: "Laura", lastName: "Muster" } },
    });
    expect(partial).toMatchObject({ ok: false, reason: "invalid", version: 2 });
    expect((await registration())?.guests[0]?.data).toEqual({
      firstName: "Laura",
      lastName: "Muster",
    });

    expect(
      await saveGuestStep(deps, context, { step: "primary", version: 2, values: { 0: laura } }),
    ).toEqual({
      ok: true,
    });
    expect(
      await saveGuestStep(deps, context, {
        step: "companions",
        version: 3,
        values: { 1: { firstName: "Mia", lastName: "Muster", birthDate: "2015-03-01" } },
      }),
    ).toEqual({ ok: true });
    expect(
      await saveGuestStep(deps, context, { step: "address", version: 4, values: { 0: address } }),
    ).toEqual({
      ok: true,
    });
    current = await registration();
    // The address step kept the personal data of the primary guest.
    expect(current?.guests[0]?.data).toEqual({ ...laura, ...address });

    expect(await submitCheckIn(deps, context, { version: 5, confirmed: false })).toEqual({
      ok: false,
      reason: "not-confirmed",
    });
    const submitted = await submitCheckIn(deps, context, { version: 5, confirmed: true });
    expect(submitted).toMatchObject({ ok: true, newlySubmitted: true });
    // Double submit: success, nothing new.
    expect(await submitCheckIn(deps, context, { version: 5, confirmed: true })).toMatchObject({
      ok: true,
      newlySubmitted: false,
    });
    current = await registration();
    expect(current?.status).toBe("submitted");
    // Retention prepared: purge date = departure + configured days.
    expect(current?.purgeAfter).toEqual(
      new Date(Date.parse("2026-08-31T10:00:00+02:00") + 90 * 86_400_000),
    );
    const syncs = await listRegistrationSyncs(db, up, current?.id ?? "");
    expect(syncs.map((sync) => [sync.provider, sync.status])).toEqual([
      ["apaleo", "pending"],
      ["feratel", "pending"],
    ]);
    // Submitted registrations cannot be changed by the guest.
    expect(
      await saveGuestStep(deps, context, { step: "primary", version: 6, values: { 0: laura } }),
    ).toEqual({ ok: false, reason: "submitted" });
  });

  it("refuses an incomplete submit and a stale version", async () => {
    const context = guestContext();
    await confirmTrip(deps, context, {});
    await saveGuestStep(deps, context, { step: "primary", version: 1, values: { 0: laura } });
    expect(await submitCheckIn(deps, context, { version: 2, confirmed: true })).toEqual({
      ok: false,
      reason: "incomplete",
    });
    // A second tab with an outdated version cannot overwrite newer data.
    expect(
      await saveGuestStep(deps, context, {
        step: "primary",
        version: 1,
        values: { 0: { ...laura, firstName: "Alt" } },
      }),
    ).toEqual({ ok: false, reason: "conflict" });
  });

  it("asks for the number of travellers only when the reservation does not know it", async () => {
    const context = guestContext({ guestCount: null });
    expect(await confirmTrip(deps, context, {})).toMatchObject({ ok: false, reason: "invalid" });
    expect(await confirmTrip(deps, context, { guestCount: 0 })).toMatchObject({ ok: false });
    expect(await confirmTrip(deps, context, { guestCount: 13 })).toMatchObject({ ok: false });
    expect(await confirmTrip(deps, context, { guestCount: 3 })).toEqual({ ok: true });
    expect(await registration(context)).toMatchObject({ guestCount: 3, guestCountSource: "guest" });
    expect(await confirmTrip(deps, context, { guestCount: 1 })).toEqual({ ok: true });
    expect((await registration(context))?.guestCount).toBe(1);
  });
});

describe("threats", () => {
  it("keeps registrations of different reservations and tenants apart", async () => {
    const a = guestContext();
    const b = guestContext({
      externalReservationId: "OTHER-1",
      guestAccessId: "33333333-3333-4333-8333-333333333333",
    });
    await confirmTrip(deps, a, {});
    await saveGuestStep(deps, a, { step: "primary", version: 1, values: { 0: laura } });
    // Guest B works on their own registration only – there is no id to point at A's.
    await confirmTrip(deps, b, {});
    await saveGuestStep(deps, b, {
      step: "primary",
      version: 1,
      values: { 0: { ...laura, firstName: "Bea" } },
    });
    expect((await registration(a))?.guests[0]?.data.firstName).toBe("Laura");
    expect((await registration(b))?.guests[0]?.data.firstName).toBe("Bea");
    // The same reservation id under another tenant finds nothing.
    expect(await registration(guestContext({ tenantId: "other-tenant" }))).toBeUndefined();
  });

  it("drops fields the property does not ask for (data minimisation)", async () => {
    const context = guestContext();
    await confirmTrip(deps, context, {});
    await saveGuestStep(deps, context, {
      step: "primary",
      version: 1,
      values: {
        0: { ...laura, email: "laura@example.com", documentNumber: "C01X00T47", phone: "+49 1" },
      },
    });
    const data = (await registration())?.guests[0]?.data;
    expect(data).toEqual(laura);
    // Values for travellers beyond the guest count are ignored, too.
    await saveGuestStep(deps, context, {
      step: "companions",
      version: 2,
      values: {
        1: { firstName: "Mia", lastName: "M", birthDate: "2015-03-01" },
        5: { firstName: "X", lastName: "Y" },
      },
    });
    expect((await registration())?.guests.map((guest) => guest.position)).toEqual([0, 1]);
  });

  it("rate limits writes per reservation", async () => {
    const context = guestContext();
    await confirmTrip(deps, context, {});
    let last;
    // confirmTrip counted one write already.
    for (let index = 1; index < CHECK_IN_RATE_LIMIT.max; index++) {
      last = await saveGuestStep(deps, context, { step: "primary", version: 999, values: {} });
    }
    expect(last).toMatchObject({ ok: false, reason: "conflict" });
    expect(
      await saveGuestStep(deps, context, { step: "primary", version: 2, values: { 0: laura } }),
    ).toEqual({
      ok: false,
      reason: "rate-limited",
    });
  }, 60_000);

  it("never logs personal data", async () => {
    const context = guestContext();
    await confirmTrip(deps, context, {});
    await saveGuestStep(deps, context, { step: "primary", version: 1, values: { 0: laura } });
    await saveGuestStep(deps, context, { step: "address", version: 2, values: { 0: address } });
    await saveGuestStep(deps, context, {
      step: "companions",
      version: 3,
      values: { 1: { firstName: "Mia", lastName: "Muster", birthDate: "2015-03-01" } },
    });
    await submitCheckIn(deps, context, { version: 4, confirmed: true });
    const log = lines.join("\n");
    expect(log).toContain("check-in submitted");
    for (const value of [
      "Laura",
      "Muster",
      "Mia",
      "1990-05-17",
      "2015-03-01",
      "Seeweg",
      "88131",
      "ABCDEFGH-1",
    ]) {
      expect(log, value).not.toContain(value);
    }
  });
});

describe("form model", () => {
  it("builds fields per step and position, prefilled from the draft", async () => {
    const context = guestContext();
    await confirmTrip(deps, context, {});
    await saveGuestStep(deps, context, { step: "primary", version: 1, values: { 0: laura } });
    const availability = await checkInAvailability(deps, context);
    if (!availability.available) throw new Error("unavailable");
    const primary = buildStepForm(availability.journey, "primary");
    expect(primary).toHaveLength(1);
    expect(
      primary[0]?.fields.map((field) => [field.name, field.kind, field.required, field.value]),
    ).toEqual([
      ["g0.firstName", "text", true, "Laura"],
      ["g0.lastName", "text", true, "Muster"],
      ["g0.birthDate", "date", true, "1990-05-17"],
      ["g0.nationality", "country", true, "DE"],
    ]);
    const companions = buildStepForm(availability.journey, "companions");
    expect(companions.map((set) => set.position)).toEqual([1]);
    // Nationality is required for adults only (children rules) – not marked required in the form.
    expect(companions[0]?.fields.find((field) => field.field === "nationality")?.required).toBe(
      false,
    );
    // No autofill of personal data for fellow travellers.
    expect(companions[0]?.fields.every((field) => field.autoComplete === "off")).toBe(true);
    expect(
      buildStepForm(availability.journey, "address")[0]?.fields.map((field) => field.field),
    ).toEqual(["street", "postalCode", "city", "country"]);
  });
});
