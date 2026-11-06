/**
 * Check-in validation in the app (ADR 0021, C2/C3): responsible adult, postal codes, shared
 * address, operational contact data with its own retention, company billing and the review
 * status. Runs against the real repository (PGlite); no provider is contacted.
 */
import { DEFAULT_CHECK_IN_VALIDATION_POLICY, type PropertyRegistrationConfig } from "@up/core";
import {
  type Database,
  getRegistrationForReservation,
  saveJourneySettings,
  schema,
  seedTenant,
  uniquePlacesSeed,
} from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkInAvailability,
  type CheckInDeps,
  confirmTrip,
  effectiveStepFields,
  saveBillingStep,
  saveGuestStep,
  sharedAddressOffered,
  submitCheckIn,
} from "./check-in-service";
import { buildBillingForm, buildStepForm, visibleSteps } from "./form-model";
import { billingRows, reviewStatusRows } from "./review-status";
import {
  BEFORE_ARRIVAL,
  capturingLogger,
  guestContext,
  testRegistrationConfig,
} from "./test-context";

const policy = { ...DEFAULT_CHECK_IN_VALIDATION_POLICY, addressSuggestions: "off" as const };
const config: PropertyRegistrationConfig = {
  ...testRegistrationConfig,
  country: "AT",
  targets: [],
  legalTemplate: "at-meldeg",
  validation: policy,
  retentionDaysAfterDeparture: 30,
  contactRetentionDaysAfterDeparture: 7,
};

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
const lauraAddress = {
  street: "Seeweg 3",
  postalCode: "88131",
  city: "Lindau",
  country: "DE",
  documentType: "passport",
  documentNumber: "C01X00T47",
};
const tom = {
  firstName: "Tom",
  lastName: "Muster",
  birthDate: "1988-02-01",
  nationality: "AT",
  phone: "+43 664 1234567",
};

let test: TestDatabase;
let db: Database;
let deps: CheckInDeps;
let lines: string[];
const context = guestContext({ guestCount: { adults: 2, children: 0 } });

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  await seedTenant(db, uniquePlacesSeed);
  await saveJourneySettings(db, up, "hov", { registration: config, access });
  const captured = capturingLogger();
  lines = captured.lines;
  deps = { db, logger: captured.logger, now: () => BEFORE_ARRIVAL };
  await confirmTrip(deps, context);
});

afterEach(async () => {
  await test.close();
});

async function current() {
  return getRegistrationForReservation(db, context, {
    reservationProvider: context.reservationProvider,
    externalReservationId: context.externalReservationId,
  });
}

async function journey() {
  const availability = await checkInAvailability(deps, context);
  if (!availability.available) throw new Error(availability.reason);
  return availability.journey;
}

async function version() {
  return (await current())?.version ?? 0;
}

describe("responsible adult (server-side)", () => {
  it("refuses a main guest under 18 on the arrival day and saves nothing", async () => {
    // Arrival 2026-08-27: born 2008-09-01 → 17.
    const result = await saveGuestStep(deps, context, {
      step: "guests",
      version: await version(),
      values: { 0: { ...laura, birthDate: "2008-09-01" }, 1: { ...tom, ...lauraAddress } },
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (result.ok || result.reason !== "invalid") throw new Error("expected invalid");
    expect(result.errors[0]).toContainEqual({ field: "birthDate", code: "responsible-under-age" });
    expect((await current())?.guests).toEqual([]);
  });

  it("accepts the 18th birthday on the arrival day; a companion may be younger", async () => {
    const result = await saveGuestStep(deps, context, {
      step: "guests",
      version: await version(),
      values: {
        0: { ...laura, birthDate: "2008-08-27" },
        1: {
          ...tom,
          birthDate: "2012-01-01",
          street: "Dorf 1",
          postalCode: "6793",
          city: "Gaschurn",
          country: "AT",
        },
      },
    });
    expect(result).toEqual({ ok: true });
  });
});

describe("international postal codes", () => {
  it("rejects a postal code that does not fit the country and accepts countries without one", async () => {
    const wrong = await saveGuestStep(deps, context, {
      step: "address",
      version: await version(),
      values: { 0: { ...lauraAddress, country: "AT", postalCode: "88131" } },
    });
    expect(wrong).toMatchObject({ ok: false, reason: "invalid" });
    if (wrong.ok || wrong.reason !== "invalid") throw new Error("expected invalid");
    expect(wrong.errors[0]).toContainEqual({ field: "postalCode", code: "invalid-postal-code" });

    const british = await saveGuestStep(deps, context, {
      step: "address",
      version: await version(),
      values: { 0: { ...lauraAddress, country: "GB", postalCode: "SW1A 1AA" } },
    });
    expect(british).toEqual({ ok: true });
  });
});

describe("shared address of fellow travellers", () => {
  it("is offered to companions only and stores a reference instead of a copy", async () => {
    const j = await journey();
    expect(sharedAddressOffered(j, "guests", 0)).toBe(false);
    expect(sharedAddressOffered(j, "guests", 1)).toBe(true);
    expect(sharedAddressOffered(j, "address", 0)).toBe(false);

    const result = await saveGuestStep(deps, context, {
      step: "guests",
      version: await version(),
      // The hidden address inputs still arrive – they are ignored.
      values: { 0: laura, 1: { ...tom, street: "Anderswo 9", city: "Wien", country: "AT" } },
      addressSources: { 1: "same-as-primary" },
    });
    expect(result).toEqual({ ok: true });
    const stored = (await current())?.guests.find((guest) => guest.position === 1);
    expect(stored?.addressSource).toBe("same-as-primary");
    expect(stored?.data.street).toBeUndefined();

    const rows = (await db.select().from(schema.guestRegistrationGuests)).filter(
      (row) => row.position === 1,
    );
    expect(rows[0]).toMatchObject({ addressSource: "same-as-primary", street: null, city: null });

    const [, companion] = buildStepForm(await journey(), "guests");
    expect(companion).toMatchObject({
      complete: true,
      sharedAddress: { name: "g1.addressSource", checked: true },
    });
  });

  it("requires the companion's own address once the box is unticked", async () => {
    await saveGuestStep(deps, context, {
      step: "guests",
      version: await version(),
      values: { 0: laura, 1: tom },
      addressSources: { 1: "same-as-primary" },
    });
    const result = await saveGuestStep(deps, context, {
      step: "guests",
      version: await version(),
      values: { 0: laura, 1: tom },
      addressSources: { 1: "own" },
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (result.ok || result.reason !== "invalid") throw new Error("expected invalid");
    expect(result.errors[1]?.map((error) => error.field)).toEqual(
      expect.arrayContaining(["street", "city", "country"]),
    );
    expect(effectiveStepFields(await journey(), "guests", 1, "own")).toContain("street");
  });

  it("is not offered when the property disallows it", async () => {
    await saveJourneySettings(db, up, "hov", {
      registration: {
        ...config,
        validation: { ...policy, sharedAddress: "never" },
      },
      access,
    });
    expect(sharedAddressOffered(await journey(), "guests", 1)).toBe(false);
    const result = await saveGuestStep(deps, context, {
      step: "guests",
      version: await version(),
      values: { 0: laura, 1: tom },
      addressSources: { 1: "same-as-primary" },
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("company billing", () => {
  it("is a visible step only with companyBilling and defaults to private", async () => {
    expect(visibleSteps(await journey())).toEqual([
      "trip",
      "guests",
      "address",
      "billing",
      "review",
    ]);
    expect(buildBillingForm(await journey()).kind).toBe("private");
    await saveJourneySettings(db, up, "hov", {
      registration: { ...config, validation: { ...policy, companyBilling: false } },
      access,
    });
    expect(visibleSteps(await journey())).not.toContain("billing");
    expect(await saveBillingStep(deps, context, { version: await version(), values: {} })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("validates and stores a company independently of the registration address", async () => {
    const invalid = await saveBillingStep(deps, context, {
      version: await version(),
      values: {
        billingKind: "company",
        companyName: "",
        street: "",
        city: "",
        country: "DE",
        vatId: "XX",
      },
    });
    expect(invalid).toMatchObject({ ok: false, reason: "invalid" });
    if (invalid.ok || invalid.reason !== "invalid") throw new Error("expected invalid");
    expect(invalid.issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(["companyName", "street", "city", "vatId"]),
    );

    const saved = await saveBillingStep(deps, context, {
      version: await version(),
      values: {
        billingKind: "company",
        companyName: "Muster GmbH",
        street: "Hafenstraße 1",
        postalCode: "6900",
        city: "Bregenz",
        country: "AT",
        vatId: "ATU 12345678",
        contactFirstName: "Laura",
        contactLastName: "Muster",
      },
    });
    expect(saved).toEqual({ ok: true });
    const j = await journey();
    expect(j.registration?.billing).toMatchObject({
      kind: "company",
      companyName: "Muster GmbH",
      vatId: "ATU12345678",
    });
    expect(j.assessment.steps.billing).toBe("complete");
    // The main guest's (registration) data is untouched.
    expect(j.registration?.guests).toEqual([]);
    expect(billingRows(j.registration?.billing, (code) => code)).toContainEqual({
      id: "city",
      value: "6900 Bregenz",
    });
    expect(buildBillingForm(j)).toMatchObject({ kind: "company" });
    expect(lines.join("\n")).not.toContain("Muster GmbH");
  });
});

describe("submission, retention and status", () => {
  async function complete() {
    await saveGuestStep(deps, context, {
      step: "guests",
      version: await version(),
      values: { 0: laura, 1: tom },
      addressSources: { 1: "same-as-primary" },
    });
    await saveGuestStep(deps, context, {
      step: "address",
      version: await version(),
      values: { 0: lauraAddress },
    });
    await saveBillingStep(deps, context, {
      version: await version(),
      values: { billingKind: "private" },
    });
  }

  it("gives contact data its own, shorter retention", async () => {
    await complete();
    expect((await journey()).assessment.readyToSubmit).toBe(true);
    const result = await submitCheckIn(deps, context, {
      version: await version(),
      confirmed: true,
    });
    expect(result).toMatchObject({ ok: true });
    const [registration] = await db.select().from(schema.guestRegistrations);
    const contacts = await db.select().from(schema.guestRegistrationContacts);
    const contact = contacts.find((row) => row.position === 0);
    expect(
      contacts.every((row) => row.purgeAfter?.getTime() === contact?.purgeAfter?.getTime()),
    ).toBe(true);
    // Departure 2026-08-31 10:00 +02:00 → +30 days (registration) / +7 days (contacts).
    expect(registration?.purgeAfter?.toISOString()).toBe("2026-09-30T08:00:00.000Z");
    expect(contact?.purgeAfter?.toISOString()).toBe("2026-09-07T08:00:00.000Z");
    expect(contact).toMatchObject({ email: "laura.muster@example.com", phone: "+491701234567" });
    // Registration data and contact data live in separate tables.
    const guestColumns = Object.keys(
      (await db.select().from(schema.guestRegistrationGuests))[0] ?? {},
    );
    expect(guestColumns).not.toContain("email");
    expect(guestColumns).not.toContain("phone");
  });

  it("shows separate status dimensions without claiming verification", async () => {
    await complete();
    const rows = reviewStatusRows(await journey());
    expect(Object.fromEntries(rows.map((row) => [row.id, row.value]))).toEqual({
      data: "data.complete",
      age: "age.declared-adult",
      address: "address.formally-valid",
      email: "email.pending",
      phone: "phone.disabled",
      identity: "identity.not-required",
      legal: "legal.manual",
      billing: "billing.private",
    });
  });
});

describe("form labels follow the current answers", () => {
  it("never labels a field optional that the answers so far make or may make mandatory", async () => {
    const [primary, companion] = buildStepForm(await journey(), "guests");
    const of = (set: typeof primary, field: string) =>
      set?.fields.find((def) => def.field === field);
    expect(of(primary, "phone")).toMatchObject({ required: true, requirement: "required" });
    expect(of(companion, "phone")).toMatchObject({ required: false, requirement: "optional" });
    // Unknown age and nationality: the document may become mandatory.
    expect(of(companion, "documentType")).toMatchObject({
      required: false,
      requirement: "conditional",
    });
    // Echoed answers after an error count: adult non-Austrian → required.
    const [, adult] = buildStepForm(await journey(), "guests", {
      values: { "g1.nationality": "DE", "g1.birthDate": "1980-01-01" },
    });
    expect(of(adult, "documentType")).toMatchObject({ required: true, requirement: "required" });
    const [, austrian] = buildStepForm(await journey(), "guests", {
      values: { "g1.nationality": "AT", "g1.birthDate": "1980-01-01" },
    });
    expect(of(austrian, "documentType")).toMatchObject({ requirement: "optional" });
  });
});
