import { type PmsGuestData, type PmsProvider } from "@up/core";
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
  stepPositions,
  submitCheckIn,
} from "./check-in-service";
import { buildStepForm, parseStepValues } from "./form-model";
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
  email: "laura.muster@example.com",
  phone: "+49 170 1234567",
  birthDate: "1990-05-17",
  nationality: "DE",
};
const address = { street: "Seeweg 3", postalCode: "88131", city: "Lindau", country: "DE" };
const tom = {
  firstName: "Tom",
  lastName: "Muster",
  birthDate: "1988-02-01",
  nationality: "AT",
  phone: "+43 664 1234567",
};
const mia = {
  firstName: "Mia",
  lastName: "Muster",
  birthDate: "2016-03-01",
  phone: "+49 171 7654321",
};

/** A PMS that knows the given guests of the reservation (index 0 = main guest). */
function pmsKnowing(guests: PmsGuestData[], calls: string[] = []): CheckInDeps["pmsFor"] {
  const pms: PmsProvider = {
    name: "fake",
    getReservation: () => Promise.reject(new Error("not used")),
    findReservationsByBookingReference: () => Promise.resolve([]),
    getReservationGuests: (id) => {
      calls.push(id);
      return Promise.resolve({ guests });
    },
  };
  return () => pms;
}

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

async function journeyOf(context = guestContext(), d = deps) {
  const availability = await checkInAvailability(d, context);
  if (!availability.available) throw new Error(`unavailable: ${availability.reason}`);
  return availability.journey;
}

describe("availability", () => {
  it("is off without database, settings, loaded reservation, occupancy or after the stay", async () => {
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
    // Without an occupancy from the reservation the guest is never asked for a number.
    expect(await checkInAvailability(deps, guestContext({ guestCount: null }))).toMatchObject({
      available: false,
      reason: "occupancy-unknown",
    });
    expect(
      await checkInAvailability(deps, guestContext({ tenantId: "other-tenant" })),
    ).toMatchObject({
      available: false,
    });
    expect((await checkInAvailability(deps, guestContext())).available).toBe(true);
  });
});

describe("number of travellers comes from the reservation", () => {
  it("creates exactly one slot for one booked guest (case 5)", async () => {
    const context = guestContext({ guestCount: { adults: 1, children: 0 } });
    await confirmTrip(deps, context);
    expect(await registration(context)).toMatchObject({
      guestCount: 1,
      guestCountSource: "reservation",
    });
    expect(stepPositions(await journeyOf(context), "guests")).toEqual([0]);
  });

  it("creates exactly three slots for 2 adults + 1 child (case 6)", async () => {
    const context = guestContext({ guestCount: { adults: 2, children: 1 } });
    await confirmTrip(deps, context);
    const journey = await journeyOf(context);
    expect(journey.registration?.guestCount).toBe(3);
    expect(buildStepForm(journey, "guests").map((set) => set.position)).toEqual([0, 1, 2]);
  });

  it("follows an occupancy change of a draft visibly and keeps entered data (case 10)", async () => {
    const two = guestContext({ guestCount: { adults: 2, children: 0 } });
    await confirmTrip(deps, two);
    let current = await registration(two);
    await saveGuestStep(deps, two, {
      step: "guests",
      version: current?.version ?? 0,
      values: { 0: laura, 1: tom },
    });
    // The reservation now has 3 travellers: the check-in follows and says so.
    const three = guestContext({ guestCount: { adults: 2, children: 1 } });
    const journey = await journeyOf(three, {
      ...deps,
      pmsFor: pmsKnowing([{}, {}, { firstName: "Mia", lastName: "Muster" }]),
    });
    expect(journey.registration).toMatchObject({ guestCount: 3 });
    expect(journey.registration?.guestCountChangedAt).toBeInstanceOf(Date);
    expect(journey.registration?.guests.map((guest) => guest.data.firstName)).toEqual([
      "Laura",
      "Tom",
      "Mia",
    ]);
    expect(journey.assessment.readyToSubmit).toBe(false);
    // Down to 1: nothing deleted while it is a draft, but only one person is registered.
    const one = guestContext({ guestCount: { adults: 1, children: 0 } });
    const reduced = await journeyOf(one);
    expect(reduced.registration?.guestCount).toBe(1);
    expect(stepPositions(reduced, "guests")).toEqual([0]);
    current = await registration(one);
    expect(current?.guests.map((guest) => guest.position)).toEqual([0, 1, 2]);
    await saveGuestStep(deps, one, {
      step: "address",
      version: current?.version ?? 0,
      values: { 0: address },
    });
    current = await registration(one);
    expect(current?.guestCountChangedAt).toBeUndefined();
    expect(
      await submitCheckIn(deps, one, { version: current?.version ?? 0, confirmed: true }),
    ).toMatchObject({ ok: true });
    // Submitted with exactly the booked number of people.
    expect((await registration(one))?.guests.map((guest) => guest.position)).toEqual([0]);
    // After submission the registration is not changed silently.
    const later = await journeyOf(three);
    expect(later.registration).toMatchObject({ status: "submitted", guestCount: 1 });
  });
});

describe("prefill from the reservation", () => {
  it("prefills complete main guest data incl. real e-mail and phone (cases 1, 4, 8)", async () => {
    const context = guestContext({ guestCount: { adults: 1, children: 0 } });
    const calls: string[] = [];
    await confirmTrip({ ...deps, pmsFor: pmsKnowing([{ ...laura, ...address }], calls) }, context);
    expect(calls).toEqual(["ABCDEFGH-1"]);
    const journey = await journeyOf(context);
    const [guest] = journey.registration?.guests ?? [];
    expect(guest?.data).toMatchObject({
      email: "laura.muster@example.com",
      phone: "+491701234567",
      street: "Seeweg 3",
    });
    expect(guest?.prefilledFields).toContain("phone");
    // Nothing left to ask: straight to the review.
    expect(journey.assessment).toMatchObject({ readyToSubmit: true, nextStep: "review" });
    const [set] = buildStepForm(journey, "guests");
    expect(set).toMatchObject({ complete: true, prefilled: true, displayName: "Laura Muster" });
    expect(set?.fields.find((field) => field.field === "phone")).toMatchObject({
      value: "0170 1234567",
      phoneCountry: "DE",
    });
  });

  it("never prefills a Booking.com relay address and requires a real e-mail (case 3)", async () => {
    const context = guestContext({ guestCount: { adults: 1, children: 0 } });
    await confirmTrip(
      { ...deps, pmsFor: pmsKnowing([{ ...laura, email: "example@guest.booking.com" }]) },
      context,
    );
    let current = await registration(context);
    expect(current?.guests[0]?.data.email).toBeUndefined();
    const [set] = buildStepForm(await journeyOf(context), "guests");
    expect(set?.missing).toEqual(["email"]);
    expect(set?.fields.find((field) => field.field === "email")?.value).toBe("");
    // Typing the relay address is refused, too – it never reaches the check-in state.
    const refused = await saveGuestStep(deps, context, {
      step: "guests",
      version: current?.version ?? 0,
      values: { 0: { ...laura, email: "example@guest.booking.com" } },
    });
    expect(refused).toMatchObject({
      ok: false,
      reason: "invalid",
      errors: { 0: [{ field: "email", code: "relay-email" }] },
    });
    current = await registration(context);
    expect(current?.guests[0]?.data.email).toBeUndefined();
  });

  it("requires the phone when the reservation has none (case 2)", async () => {
    const context = guestContext({ guestCount: { adults: 1, children: 0 } });
    const { phone: _phone, ...withoutPhone } = laura;
    await confirmTrip({ ...deps, pmsFor: pmsKnowing([withoutPhone]) }, context);
    const journey = await journeyOf(context);
    expect(buildStepForm(journey, "guests")[0]?.missing).toEqual(["phone"]);
    const result = await saveGuestStep(deps, context, {
      step: "guests",
      version: journey.registration?.version ?? 0,
      values: { 0: withoutPhone },
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      errors: { 0: [{ field: "phone", code: "required" }] },
    });
  });

  it("fills known fellow travellers and leaves unknown ones empty (case 7)", async () => {
    const context = guestContext({ guestCount: { adults: 2, children: 1 } });
    await confirmTrip(
      { ...deps, pmsFor: pmsKnowing([laura, { firstName: "Tom", lastName: "Muster" }]) },
      context,
    );
    const sets = buildStepForm(await journeyOf(context), "guests");
    expect(sets.map((set) => [set.position, set.displayName, set.prefilled])).toEqual([
      [0, "Laura Muster", true],
      [1, "Tom Muster", true],
      [2, undefined, false],
    ]);
    expect(sets[2]?.fields.every((field) => field.value === "")).toBe(true);
  });

  it("keeps working without PMS data or when the PMS fails", async () => {
    const failing: CheckInDeps["pmsFor"] = () => ({
      name: "down",
      getReservation: () => Promise.reject(new Error("x")),
      findReservationsByBookingReference: () => Promise.resolve([]),
      getReservationGuests: () => Promise.reject(new Error("timeout")),
    });
    expect(await confirmTrip({ ...deps, pmsFor: failing }, guestContext())).toEqual({ ok: true });
    expect((await registration())?.guests).toEqual([]);
  });
});

describe("check-in flow", () => {
  it("runs trip → guests → address → submit and creates syncs once", async () => {
    const context = guestContext();
    expect(await confirmTrip(deps, context)).toEqual({ ok: true });
    const invalid = await saveGuestStep(deps, context, {
      step: "guests",
      version: 1,
      values: { 0: { ...laura, birthDate: "2031-01-01" }, 1: tom },
    });
    expect(invalid).toEqual({
      ok: false,
      reason: "invalid",
      errors: { 0: [{ field: "birthDate", code: "invalid" }] },
    });
    expect((await registration())?.guests).toEqual([]);
    // Missing fields: valid values are kept, the guest is told what is missing.
    const partial = await saveGuestStep(deps, context, {
      step: "guests",
      version: 1,
      values: { 0: { firstName: "Laura", lastName: "Muster" }, 1: tom },
    });
    expect(partial).toMatchObject({ ok: false, reason: "invalid", version: 2 });
    expect(
      await saveGuestStep(deps, context, {
        step: "guests",
        version: 2,
        values: { 0: laura, 1: tom },
      }),
    ).toEqual({
      ok: true,
    });
    expect(
      await saveGuestStep(deps, context, { step: "address", version: 3, values: { 0: address } }),
    ).toEqual({
      ok: true,
    });
    const current = await registration();
    expect(current?.guests[0]?.data).toMatchObject({
      ...address,
      email: "laura.muster@example.com",
      phone: "+491701234567",
    });
    expect(current?.guests[0]?.prefilledFields).toBeUndefined();
    expect(await submitCheckIn(deps, context, { version: 4, confirmed: false })).toEqual({
      ok: false,
      reason: "not-confirmed",
    });
    expect(await submitCheckIn(deps, context, { version: 4, confirmed: true })).toMatchObject({
      ok: true,
      newlySubmitted: true,
    });
    expect(await submitCheckIn(deps, context, { version: 4, confirmed: true })).toMatchObject({
      ok: true,
      newlySubmitted: false,
    });
    const syncs = await listRegistrationSyncs(db, up, current?.id ?? "");
    expect(syncs.map((sync) => [sync.provider, sync.status])).toEqual([
      ["apaleo", "pending"],
      ["feratel", "pending"],
    ]);
    expect(
      await saveGuestStep(deps, context, { step: "guests", version: 5, values: { 0: laura } }),
    ).toEqual({
      ok: false,
      reason: "submitted",
    });
  });

  it("cannot be completed while a fellow traveller's phone is missing (case 9)", async () => {
    const context = guestContext({ guestCount: { adults: 2, children: 1 } });
    await confirmTrip(deps, context);
    const { phone: _phone, ...miaWithoutPhone } = mia;
    const saved = await saveGuestStep(deps, context, {
      step: "guests",
      version: 1,
      values: { 0: laura, 1: tom, 2: miaWithoutPhone },
    });
    expect(saved).toMatchObject({
      ok: false,
      errors: { 2: [{ field: "phone", code: "required" }] },
    });
    await saveGuestStep(deps, context, { step: "address", version: 2, values: { 0: address } });
    expect(await submitCheckIn(deps, context, { version: 3, confirmed: true })).toEqual({
      ok: false,
      reason: "incomplete",
    });
    expect(
      await saveGuestStep(deps, context, {
        step: "guests",
        version: 3,
        values: { 0: laura, 1: tom, 2: mia },
      }),
    ).toEqual({
      ok: true,
    });
    expect(await submitCheckIn(deps, context, { version: 4, confirmed: true })).toMatchObject({
      ok: true,
    });
  });

  it("flags only age-independent fields of a fellow traveller without birth date", async () => {
    const context = guestContext({ guestCount: { adults: 1, children: 1 } });
    await confirmTrip(deps, context);
    const saved = await saveGuestStep(deps, context, {
      step: "guests",
      version: 1,
      values: { 0: laura, 1: { firstName: "Mia" } },
    });
    expect(saved).toMatchObject({ ok: false });
    const errors = !saved.ok && saved.reason === "invalid" ? (saved.errors[1] ?? []) : [];
    const fields = errors.map((error) => error.field);
    // Nationality depends on the age (child rules); the birth date is asked first.
    expect(fields.sort()).toEqual(["birthDate", "lastName", "phone"]);
  });

  it("reads the phone with its calling code and refuses landlines", async () => {
    const context = guestContext({ guestCount: { adults: 1, children: 0 } });
    await confirmTrip(deps, context);
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...laura, phone: "0664 1234567" }))
      form.set(`g0.${key}`, value);
    form.set("g0.phoneCountry", "AT");
    const journey = await journeyOf(context);
    const { values } = parseStepValues(
      form,
      [0],
      () => buildStepForm(journey, "guests")[0]?.fields.map((field) => field.field) ?? [],
    );
    expect(await saveGuestStep(deps, context, { step: "guests", version: 1, values })).toEqual({
      ok: true,
    });
    expect((await registration(context))?.guests[0]?.data.phone).toBe("+436641234567");
    const landline = await saveGuestStep(deps, context, {
      step: "guests",
      version: 2,
      values: { 0: { ...laura, phone: "+49 30 12345678" } },
    });
    expect(landline).toMatchObject({ errors: { 0: [{ field: "phone", code: "not-mobile" }] } });
  });

  it("refuses a stale version", async () => {
    const context = guestContext();
    await confirmTrip(deps, context);
    await saveGuestStep(deps, context, {
      step: "guests",
      version: 1,
      values: { 0: laura, 1: tom },
    });
    expect(
      await saveGuestStep(deps, context, {
        step: "guests",
        version: 1,
        values: { 0: laura, 1: tom },
      }),
    ).toEqual({
      ok: false,
      reason: "conflict",
    });
  });
});

describe("threats", () => {
  it("keeps registrations of different reservations and tenants apart", async () => {
    const a = guestContext({ guestCount: { adults: 1, children: 0 } });
    const b = guestContext({
      guestCount: { adults: 1, children: 0 },
      externalReservationId: "OTHER-1",
      guestAccessId: "33333333-3333-4333-8333-333333333333",
    });
    await confirmTrip(deps, a);
    await saveGuestStep(deps, a, { step: "guests", version: 1, values: { 0: laura } });
    await confirmTrip(deps, b);
    await saveGuestStep(deps, b, {
      step: "guests",
      version: 1,
      values: { 0: { ...laura, firstName: "Bea" } },
    });
    expect((await registration(a))?.guests[0]?.data.firstName).toBe("Laura");
    expect((await registration(b))?.guests[0]?.data.firstName).toBe("Bea");
    expect(await registration(guestContext({ tenantId: "other-tenant" }))).toBeUndefined();
  });

  it("drops fields the property does not ask for and travellers beyond the booking", async () => {
    const context = guestContext({ guestCount: { adults: 2, children: 0 } });
    await confirmTrip(deps, context);
    await saveGuestStep(deps, context, {
      step: "guests",
      version: 1,
      values: {
        0: { ...laura, documentNumber: "C01X00T47", comment: "hi" },
        1: { ...tom, email: "tom@example.com" },
        5: { firstName: "X", lastName: "Y", phone: "+491701111111" },
      },
    });
    const current = await registration(context);
    expect(current?.guests.map((guest) => guest.position)).toEqual([0, 1]);
    expect(current?.guests[0]?.data).not.toHaveProperty("documentNumber");
    // No e-mail is collected for fellow travellers.
    expect(current?.guests[1]?.data).not.toHaveProperty("email");
  });

  it("rate limits writes per reservation", async () => {
    const context = guestContext();
    await confirmTrip(deps, context);
    let last;
    // confirmTrip counted one write already.
    for (let index = 1; index < CHECK_IN_RATE_LIMIT.max; index++) {
      last = await saveGuestStep(deps, context, { step: "guests", version: 999, values: {} });
    }
    expect(last).toMatchObject({ ok: false, reason: "conflict" });
    expect(
      await saveGuestStep(deps, context, { step: "guests", version: 2, values: { 0: laura } }),
    ).toEqual({
      ok: false,
      reason: "rate-limited",
    });
  }, 60_000);

  it("never logs personal or contact data", async () => {
    const context = guestContext();
    await confirmTrip(
      { ...deps, pmsFor: pmsKnowing([{ ...laura, email: "x@guest.booking.com" }]) },
      context,
    );
    await saveGuestStep(deps, context, {
      step: "guests",
      version: 1,
      values: { 0: laura, 1: tom },
    });
    await saveGuestStep(deps, context, { step: "address", version: 2, values: { 0: address } });
    await submitCheckIn(deps, context, { version: 3, confirmed: true });
    const log = lines.join("\n");
    expect(log).toContain("check-in submitted");
    for (const value of [
      "Laura",
      "Muster",
      "Tom",
      "1990-05-17",
      "Seeweg",
      "88131",
      "ABCDEFGH-1",
      "example.com",
      "guest.booking.com",
      "1234567",
    ]) {
      expect(log, value).not.toContain(value);
    }
  });
});
