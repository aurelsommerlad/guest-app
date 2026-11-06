import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database } from "../client";
import {
  guestRegistrationBilling,
  guestRegistrationContacts,
  guestRegistrationGuests,
} from "../schema";
import { seedTenant } from "../seed/seed-tenant";
import { uniquePlacesSeed } from "../seed/unique-places";
import {
  createTestDatabase,
  expectConstraintViolation,
  type TestDatabase,
} from "../testing/test-database";
import {
  getRegistrationById,
  purgeExpiredRegistrationData,
  saveRegistrationBilling,
  saveRegistrationGuests,
  seedRegistrationGuests,
  startRegistration,
  submitRegistration,
} from "./registration-repository";

let db: Database;
let client: TestDatabase["client"];
let close: () => Promise<void>;
const up = { tenantId: "unique-places" };
const other = { tenantId: "other-tenant" };
const now = new Date("2026-11-06T10:00:00Z");
let counter = 0;

async function start(guestCount = 2) {
  counter += 1;
  return startRegistration(db, up, {
    reservationProvider: "apaleo",
    externalReservationId: `SEP-${counter}`,
    propertyId: "hov",
    guestCount,
    guestCountSource: "reservation",
    arrivalAt: new Date("2026-12-20T14:00:00Z"),
    departureAt: new Date("2026-12-27T09:00:00Z"),
  });
}

const lea = {
  firstName: "Lea",
  lastName: "Beispiel",
  email: "lea@example.org",
  phone: "+436641234567",
  birthDate: "1985-02-02",
  nationality: "AT",
  street: "Dorfstraße 1",
  postalCode: "6793",
  city: "Gaschurn",
  country: "AT",
};

beforeAll(async () => {
  ({ db, client, close } = await createTestDatabase());
  await seedTenant(db, uniquePlacesSeed);
});

afterAll(async () => {
  await close();
});

describe("legal and contact data are stored apart", () => {
  it("e-mail and phone live in guest_registration_contacts, the rest in guests", async () => {
    const registration = await start(1);
    await saveRegistrationGuests(db, up, registration.id, 1, [
      { position: 0, role: "primary", data: lea },
    ]);
    const guestColumns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'guest_registration_guests'`,
    );
    const names = guestColumns.rows.map((row) => row.column_name);
    expect(names).not.toContain("email");
    expect(names).not.toContain("phone");
    const [contact] = await db
      .select()
      .from(guestRegistrationContacts)
      .where(sql`${guestRegistrationContacts.registrationId} = ${registration.id}`);
    expect(contact).toMatchObject({
      position: 0,
      email: "lea@example.org",
      phone: "+436641234567",
    });
    // The app still sees one traveller (no parallel model).
    const reloaded = await getRegistrationById(db, up, registration.id);
    expect(reloaded?.guests[0]?.data).toEqual(lea);
  });

  it("a changed e-mail clears its confirmation; an unchanged one keeps it", async () => {
    const registration = await start(1);
    await saveRegistrationGuests(db, up, registration.id, 1, [
      { position: 0, role: "primary", data: lea },
    ]);
    await db
      .update(guestRegistrationContacts)
      .set({ emailVerifiedAt: now, emailVerifiedHash: "a".repeat(64) })
      .where(sql`${guestRegistrationContacts.registrationId} = ${registration.id}`);
    await saveRegistrationGuests(db, up, registration.id, 2, [
      { position: 0, role: "primary", data: { ...lea, city: "Schruns" } },
    ]);
    let [contact] = await db
      .select()
      .from(guestRegistrationContacts)
      .where(sql`${guestRegistrationContacts.registrationId} = ${registration.id}`);
    expect(contact?.emailVerifiedAt).toEqual(now);
    await saveRegistrationGuests(db, up, registration.id, 3, [
      { position: 0, role: "primary", data: { ...lea, email: "other@example.org" } },
    ]);
    [contact] = await db
      .select()
      .from(guestRegistrationContacts)
      .where(sql`${guestRegistrationContacts.registrationId} = ${registration.id}`);
    expect(contact).toMatchObject({ emailVerifiedAt: null, emailVerifiedHash: null });
  });

  it("PMS prefill seeds contacts for new slots only", async () => {
    const registration = await start(2);
    expect(
      await seedRegistrationGuests(db, up, registration.id, [
        {
          position: 0,
          role: "primary",
          data: { firstName: "Lea", lastName: "B", email: "lea@example.org" },
          prefilledFields: ["firstName", "lastName", "email"],
        },
      ]),
    ).toBe(1);
    const reloaded = await getRegistrationById(db, up, registration.id);
    expect(reloaded?.guests[0]?.data.email).toBe("lea@example.org");
    expect(reloaded?.guests[0]?.prefilledFields).toEqual(["firstName", "lastName", "email"]);
  });

  it("contacts have their own (shorter) retention", async () => {
    const registration = await start(1);
    await saveRegistrationGuests(db, up, registration.id, 1, [
      { position: 0, role: "primary", data: lea },
    ]);
    const contactPurge = new Date("2026-01-01T00:00:00Z");
    const legalPurge = new Date("2030-01-01T00:00:00Z");
    await submitRegistration(db, up, registration.id, {
      expectedVersion: 2,
      targets: [],
      now,
      purgeAfter: legalPurge,
      contactPurgeAfter: contactPurge,
    });
    await purgeExpiredRegistrationData(db, now);
    const reloaded = await getRegistrationById(db, up, registration.id);
    expect(reloaded?.guests[0]?.data.email).toBeUndefined();
    expect(reloaded?.guests[0]?.data.street).toBe("Dorfstraße 1");
  });
});

describe("shared address", () => {
  it("is stored as a reference: no own address columns", async () => {
    const registration = await start(2);
    await saveRegistrationGuests(db, up, registration.id, 1, [
      { position: 0, role: "primary", data: lea },
      {
        position: 1,
        role: "companion",
        addressSource: "same-as-primary",
        data: { firstName: "Max", lastName: "Beispiel", street: "ignored", city: "ignored" },
      },
    ]);
    const rows = await db
      .select()
      .from(guestRegistrationGuests)
      .where(sql`${guestRegistrationGuests.registrationId} = ${registration.id}`);
    const companion = rows.find((row) => row.position === 1);
    expect(companion).toMatchObject({
      addressSource: "same-as-primary",
      street: null,
      city: null,
      addressStatus: null,
    });
    expect(rows.find((row) => row.position === 0)?.addressStatus).toBe("formally-valid");
    const reloaded = await getRegistrationById(db, up, registration.id);
    expect(reloaded?.guests[1]?.addressSource).toBe("same-as-primary");
  });

  it("the database refuses a shared address on the main guest or with own columns", async () => {
    const registration = await start(2);
    const row = { tenantId: "unique-places", registrationId: registration.id };
    await expectConstraintViolation(
      db
        .insert(guestRegistrationGuests)
        .values({ ...row, position: 0, role: "primary", addressSource: "same-as-primary" }),
      "guest_registration_guests_address_source_valid",
    );
    await expectConstraintViolation(
      db.insert(guestRegistrationGuests).values({
        ...row,
        position: 1,
        role: "companion",
        addressSource: "same-as-primary",
        street: "x",
      }),
      "guest_registration_guests_address_source_valid",
    );
  });
});

describe("billing", () => {
  it("company recipient is stored apart and never changes the registration address", async () => {
    const registration = await start(1);
    await saveRegistrationGuests(db, up, registration.id, 1, [
      { position: 0, role: "primary", data: lea },
    ]);
    const saved = await saveRegistrationBilling(db, up, registration.id, 2, {
      kind: "company",
      companyName: "Muster GmbH",
      street: "Industriestraße 4",
      postalCode: "6900",
      city: "Bregenz",
      country: "AT",
      vatId: "ATU12345678",
      contactPerson: { firstName: "Lea", lastName: "Beispiel" },
    });
    expect(saved).toEqual({ ok: true, version: 3 });
    const reloaded = await getRegistrationById(db, up, registration.id);
    expect(reloaded?.billing).toMatchObject({
      kind: "company",
      companyName: "Muster GmbH",
      vatId: "ATU12345678",
    });
    expect(reloaded?.guests[0]?.data.street).toBe("Dorfstraße 1");
    const [row] = await db
      .select()
      .from(guestRegistrationBilling)
      .where(sql`${guestRegistrationBilling.registrationId} = ${registration.id}`);
    expect(row?.addressStatus).toBe("formally-valid");
  });

  it("switching back to private clears the company data; stale versions are refused", async () => {
    const registration = await start(1);
    await saveRegistrationBilling(db, up, registration.id, 1, {
      kind: "company",
      companyName: "A",
      street: "B 1",
      postalCode: "6900",
      city: "C",
      country: "AT",
    });
    expect(await saveRegistrationBilling(db, up, registration.id, 1, { kind: "private" })).toEqual({
      ok: false,
      reason: "conflict",
    });
    await saveRegistrationBilling(db, up, registration.id, 2, { kind: "private" });
    const reloaded = await getRegistrationById(db, up, registration.id);
    expect(reloaded?.billing).toEqual({ kind: "private" });
  });

  it("is tenant-scoped and checked by the database", async () => {
    const registration = await start(1);
    expect(
      await saveRegistrationBilling(db, other, registration.id, 1, { kind: "private" }),
    ).toMatchObject({ ok: false });
    await expectConstraintViolation(
      db
        .insert(guestRegistrationBilling)
        .values({ tenantId: "unique-places", registrationId: registration.id, kind: "company" }),
      "guest_registration_billing_shape",
    );
  });

  it("is purged with the registration", async () => {
    const registration = await start(1);
    await saveRegistrationGuests(db, up, registration.id, 1, [
      { position: 0, role: "primary", data: lea },
    ]);
    await saveRegistrationBilling(db, up, registration.id, 2, { kind: "private" });
    await submitRegistration(db, up, registration.id, {
      expectedVersion: 3,
      targets: [],
      now,
      purgeAfter: new Date("2026-01-01T00:00:00Z"),
    });
    await purgeExpiredRegistrationData(db, now);
    const reloaded = await getRegistrationById(db, up, registration.id);
    expect(reloaded?.billing).toBeUndefined();
    expect(reloaded?.guests).toEqual([]);
  });
});
