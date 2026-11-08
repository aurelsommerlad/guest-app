import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database } from "../client";
import { createAdminUser } from "../repositories/admin-repository";
import { seedTenant } from "../seed/seed-tenant";
import { uniquePlacesSeed } from "../seed/unique-places";
import { createTestDatabase, type TestDatabase } from "../testing/test-database";
import { type ExtrasSnapshotLike, importExtrasSnapshot } from "./importer";
import { reconcileExtras, renderImportReport } from "./reconcile";

const up = { tenantId: "unique-places" };
const SHA = "c".repeat(64);
const now = new Date("2026-11-08T12:00:00Z");

/** A minimized snapshot (as written by the M0 export – no names, e-mails or passwords). */
function snapshot(overrides: Record<string, unknown> = {}): ExtrasSnapshotLike {
  const item = (serviceId: string, extra: Record<string, unknown> = {}) => ({
    serviceId,
    code: serviceId.split("-").slice(1).join("-"),
    name: serviceId,
    displayName: `${serviceId} Anzeige`,
    description: "",
    active: true,
    bookingRule: "per_stay",
    fulfillmentMode: "instant",
    actionType: "service",
    extraPersonPricePerNight: null,
    allowedUnitGroupIds: [],
    sortOrder: 1,
    requiresRemainingCapacity: false,
    requiresVehicleRegistration: false,
    maxOnePerReservation: false,
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...extra,
  });
  const data: Record<string, unknown> = {
    users: [
      { id: "u1", username: "pseudonym-1", role: "admin" },
      { id: "u2", username: "pseudonym-2", role: "manager" },
    ],
    "catalog:ALTUS:items": {
      "ALTUS-LCO": item("ALTUS-LCO", {
        bookingRule: "departure_day",
        displayNameDe: "Später Check-out",
      }),
      "ALTUS-HUND": item("ALTUS-HUND", { bookingRule: "per_night", maxOnePerReservation: true }),
      "ALTUS-PKW": item("ALTUS-PKW", {
        bookingRule: "per_night",
        requiresVehicleRegistration: true,
        fulfillmentMode: "request",
      }),
      "ALTUS-EXTRPERSON": item("ALTUS-EXTRPERSON", {
        actionType: "increase_occupancy",
        requiresRemainingCapacity: true,
        extraPersonPricePerNight: 35,
        allowedUnitGroupIds: ["ALTUS-APT"],
      }),
    },
    "catalog:HUESLE:items": {
      "HUESLE-LCO": item("HUESLE-LCO", {
        bookingRule: "departure_day",
        active: false,
        displayNameDe: "Später Check-out",
      }),
    },
    "catalog:NOWHERE:items": { "NOWHERE-X": item("NOWHERE-X") },
    "extension-night:config:ALTUS": {
      extensionNightEnabled: true,
      extensionDiscountPreArrivalOneNightGap: 12,
      extensionDiscountPreArrivalStandard: 8,
      extensionDiscountInHouseOneNightGap: 20,
      extensionDiscountInHouseStandard: 15,
      minSellableStayNights: 2,
    },
    "extension-night:config:HUESLE": {
      extensionNightEnabled: false,
      extensionDiscountOneNightGap: 10,
      extensionDiscountStandard: 5,
    },
    "image:11111111-1111-4111-8111-111111111111": { contentType: "image/jpeg", base64: "AAAA" },
    orders: [
      {
        id: "o-1",
        createdAt: "2026-10-05T09:00:00Z",
        propertyId: "ALTUS",
        reservationId: "ABCDEF-1",
        bookingId: "ABCDEF",
        items: [
          {
            serviceId: "ALTUS-LCO",
            displayName: "Später Check-out",
            count: 1,
            price: { amount: 25, currency: "EUR" },
          },
        ],
      },
      {
        id: "o-2",
        createdAt: "2026-10-07T09:00:00Z",
        propertyId: "NOWHERE",
        reservationId: "GHIJKL-1",
        items: [],
      },
    ],
    "requests:items": {
      "r-1": {
        requestId: "r-1",
        reservationId: "ABCDEF-1",
        propertyId: "ALTUS",
        serviceId: "ALTUS-PKW",
        requestedQuantity: 1,
        requestedServiceDate: "2026-10-10",
        requestedServiceDates: ["2026-10-10", "2026-10-11"],
        displayedPrice: 24,
        currency: "EUR",
        departureDate: "2026-10-12",
        status: "pending",
        createdAt: "2026-10-05T09:00:00Z",
      },
      "r-2": {
        requestId: "r-2",
        reservationId: "ABCDEF-1",
        propertyId: "ALTUS",
        serviceId: "ALTUS-PKW",
        requestedQuantity: 1,
        requestedServiceDates: ["2026-10-10"],
        bookedServiceDates: ["2026-10-10"],
        displayedPrice: 12,
        departureDate: "2026-10-12",
        status: "approved",
        createdAt: "2026-10-04T09:00:00Z",
      },
    },
    "stay-extensions:records": {
      "e-1": {
        id: "e-1",
        reservationId: "ABCDEF-1",
        propertyId: "ALTUS",
        oldDeparture: "2026-10-12",
        newDeparture: "2026-10-13",
        newDepartureConfirmed: true,
        phase: "in_house",
        gap: 2,
        originalAverageNightlyRate: 150,
        discountPercent: 15,
        extensionPrice: { amount: 127.5, currency: "EUR" },
        extras: [
          { serviceId: "ALTUS-HUND", extended: true, amount: { amount: 15, currency: "EUR" } },
        ],
        cityTax: { applicable: true, verified: true, amount: { amount: 2.5, currency: "EUR" } },
        totalAdditionalAmount: { amount: 145, currency: "EUR" },
        createdAt: "2026-10-11T10:00:00Z",
        status: "confirmed",
      },
      "e-legacy": {
        id: "e-legacy",
        reservationId: "MNOPQR-1",
        oldDeparture: "2026-08-01",
        newDeparture: "2026-08-02",
        status: "confirmed_with_issues",
      },
    },
    ...overrides,
  };
  return {
    entries: Object.entries(data).map(([key, value]) => ({
      key,
      type: key.endsWith(":items") || key.endsWith(":records") ? "hash" : "string",
      value,
    })),
  };
}

let db: Database;
let client: TestDatabase["client"];
let close: () => Promise<void>;
let ownerId: string;
let houndOfferId: string;

const run = (mode: "dry-run" | "apply", snap = snapshot(), context = up) =>
  importExtrasSnapshot(db, context, snap, {
    mode,
    snapshotSha256: SHA,
    actorAdminId: context === up ? ownerId : null,
    now,
  });
const countRows = async (table: string) =>
  Number(
    (await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)).rows[0]?.n,
  );

beforeAll(async () => {
  ({ db, client, close } = await createTestDatabase());
  await seedTenant(db, uniquePlacesSeed);
  ownerId = (
    await createAdminUser(db, up, {
      email: "owner@example.test",
      passwordHash: "scrypt$x",
      role: "owner",
    })
  ).id;
  // An offer created in STAY (Phase 1) that already references the Apaleo dog service at HØV.
  const offer = await client.query<{ id: string }>(
    `INSERT INTO offers (tenant_id, kind, category, slug, title, teaser, fulfillment, cancellation, availability, status)
     VALUES ('unique-places', 'house-service', 'pets', '{"de":"hund"}', '{"de":"Mit Hund reisen"}', '{"de":"STAY-Text"}', 'instant',
       '{"type":"non-refundable"}', '{}', 'published') RETURNING id`,
  );
  houndOfferId = offer.rows[0]?.id ?? "";
  await client.query(
    `INSERT INTO offer_properties (tenant_id, offer_id, property_id, extras_service_id, title_override)
     VALUES ('unique-places', $1, 'hov', 'ALTUS-HUND', '{"de":"STAY-Titel"}')`,
    [houndOfferId],
  );
});

afterAll(async () => {
  await close();
});

describe("Extras import", () => {
  it("dry run reports everything but changes no STAY data", async () => {
    const before = await Promise.all(
      [
        "offers",
        "offer_properties",
        "service_bookings",
        "offer_requests",
        "stay_extensions",
        "property_service_settings",
      ].map(countRows),
    );
    const result = await run("dry-run");
    const after = await Promise.all(
      [
        "offers",
        "offer_properties",
        "service_bookings",
        "offer_requests",
        "stay_extensions",
        "property_service_settings",
      ].map(countRows),
    );
    expect(after).toEqual(before);
    expect(result.summary.catalog_item).toMatchObject({ create: 4, update: 1, skip: 1 });
    expect(await countRows("migration_runs")).toBe(1);
    expect(await countRows("migration_items")).toBeGreaterThan(0);
  });

  it("applies: one central offer per service code, drafts only, existing STAY offers linked", async () => {
    const result = await run("apply");
    expect(result.summary.catalog_offer).toMatchObject({ create: 3, update: 1 });
    const lco = await client.query<{ id: string; status: string; n: string }>(
      `SELECT o.id, o.status, count(op.*)::text AS n FROM offers o JOIN offer_properties op ON op.offer_id = o.id
       WHERE o.legacy_key = 'extras:LCO' GROUP BY o.id`,
    );
    expect(lco.rows.map(({ status, n }) => ({ status, n }))).toEqual([{ status: "draft", n: "2" }]);
    // HUESLE keeps its own visibility; configuration per property.
    const huesle = await client.query<{ active: boolean; booking_rule: string }>(
      `SELECT active, booking_rule FROM offer_properties WHERE extras_service_id = 'HUESLE-LCO'`,
    );
    expect(huesle.rows).toEqual([{ active: false, booking_rule: "departure_day" }]);
    // The STAY dog offer was linked: configuration filled in, STAY texts untouched.
    const hound = await client.query<{
      offer_id: string;
      max_one_per_reservation: boolean;
      title_override: unknown;
      booking_rule: string;
    }>(
      `SELECT offer_id, max_one_per_reservation, title_override, booking_rule FROM offer_properties WHERE extras_service_id = 'ALTUS-HUND'`,
    );
    expect(hound.rows).toEqual([
      {
        offer_id: houndOfferId,
        max_one_per_reservation: true,
        title_override: { de: "STAY-Titel" },
        booking_rule: "per_night",
      },
    ]);
    const extra = await client.query<{
      extra_person_price_cents: number;
      allowed_unit_group_ids: string[];
      fulfillment: string;
    }>(
      `SELECT extra_person_price_cents, allowed_unit_group_ids, fulfillment FROM offer_properties WHERE extras_service_id = 'ALTUS-EXTRPERSON'`,
    );
    expect(extra.rows).toEqual([
      {
        extra_person_price_cents: 3500,
        allowed_unit_group_ids: ["ALTUS-APT"],
        fulfillment: "instant",
      },
    ]);
  });

  it("imports settings (legacy discounts resolved) and history without personal data", async () => {
    const settings = await client.query<{
      property_id: string;
      extension_night_enabled: boolean;
      discount_in_house_standard: number;
      discount_pre_arrival_one_night_gap: number;
    }>(
      `SELECT property_id, extension_night_enabled, discount_in_house_standard, discount_pre_arrival_one_night_gap FROM property_service_settings ORDER BY property_id`,
    );
    expect(settings.rows).toEqual([
      {
        property_id: "hov",
        extension_night_enabled: true,
        discount_in_house_standard: 15,
        discount_pre_arrival_one_night_gap: 12,
      },
      {
        property_id: "huesle",
        extension_night_enabled: false,
        discount_in_house_standard: 5,
        discount_pre_arrival_one_night_gap: 10,
      },
    ]);
    expect(await countRows("service_bookings")).toBe(1);
    expect(await countRows("service_booking_items")).toBe(1);
    const requests = await client.query<{
      status: string;
      quoted_cents: number;
      requested_dates: string[];
    }>(
      `SELECT status, quoted_cents, requested_dates FROM offer_requests WHERE source = 'extras' ORDER BY legacy_id`,
    );
    expect(requests.rows.map((r) => r.status)).toEqual(["pending", "confirmed"]);
    expect(requests.rows[0]?.requested_dates).toHaveLength(2);
    const extensions = await client.query<{
      total_additional_cents: number;
      details: { cityTax: { amountCents: number } };
    }>(`SELECT total_additional_cents, details FROM stay_extensions`);
    expect(extensions.rows).toEqual([expect.objectContaining({ total_additional_cents: 14500 })]);
    expect(extensions.rows[0]?.details.cityTax.amountCents).toBe(250);
  });

  it("is idempotent: a second apply changes nothing and creates no duplicates", async () => {
    const counts = await Promise.all(
      [
        "offers",
        "offer_properties",
        "service_bookings",
        "service_booking_items",
        "offer_requests",
        "stay_extensions",
      ].map(countRows),
    );
    const result = await run("apply");
    expect(
      await Promise.all(
        [
          "offers",
          "offer_properties",
          "service_bookings",
          "service_booking_items",
          "offer_requests",
          "stay_extensions",
        ].map(countRows),
      ),
    ).toEqual(counts);
    for (const [entity, actions] of Object.entries(result.summary)) {
      if (["user", "image"].includes(entity)) continue;
      expect({ entity, create: actions.create ?? 0, update: actions.update ?? 0 }).toEqual({
        entity,
        create: 0,
        update: entity === "catalog_offer" ? 0 : 0,
      });
    }
  });

  it("never overwrites a configuration changed in STAY after the import – it reports a conflict", async () => {
    await client.query(
      `UPDATE offer_properties SET sort_order = 5, updated_at = now() + interval '1 hour' WHERE extras_service_id = 'ALTUS-PKW'`,
    );
    const changed = snapshot();
    const altus = changed.entries.find((e) => e.key === "catalog:ALTUS:items")?.value as Record<
      string,
      Record<string, unknown>
    >;
    altus["ALTUS-PKW"] = { ...altus["ALTUS-PKW"], bookingRule: "per_stay" };
    const result = await run("apply", changed);
    expect(result.items.find((i) => i.sourceKey === "ALTUS:ALTUS-PKW")).toMatchObject({
      action: "conflict",
      reason: "changed_in_stay_since_import",
    });
    const row = await client.query<{ booking_rule: string; sort_order: number }>(
      `SELECT booking_rule, sort_order FROM offer_properties WHERE extras_service_id = 'ALTUS-PKW'`,
    );
    expect(row.rows).toEqual([{ booking_rule: "per_night", sort_order: 5 }]);
  });

  it("keeps tenants apart: another tenant without mappings imports nothing", async () => {
    await client.query(
      `INSERT INTO tenants (id, slug, name) VALUES ('other-tenant', 'other-tenant', 'Other')`,
    );
    const before = await countRows("offer_properties");
    const result = await run("apply", snapshot(), { tenantId: "other-tenant" });
    expect(result.summary.catalog_item).toEqual({ skip: 6 });
    expect(await countRows("offer_properties")).toBe(before);
  });

  it("reconciles and reports without names or e-mail addresses", async () => {
    const result = await run("dry-run");
    const reconciliation = await reconcileExtras(db, up, snapshot());
    const statuses = Object.fromEntries(reconciliation.catalog.map((c) => [c.serviceId, c.status]));
    expect(statuses).toMatchObject({
      "ALTUS-LCO": "match",
      "HUESLE-LCO": "match",
      "NOWHERE-X": "unmapped",
      "ALTUS-HUND": "match",
    });
    expect(reconciliation.history).toEqual([
      { entity: "Bestellungen", source: 2, imported: 1 },
      { entity: "Anfragen", source: 2, imported: 2 },
      { entity: "Verlängerungen", source: 2, imported: 1 },
    ]);
    const report = renderImportReport(result, reconciliation);
    expect(report).toContain("property_not_mapped");
    expect(report).not.toMatch(/pseudonym|@/);
    const users = result.items.filter((i) => i.entityType === "user").map((i) => i.reason);
    expect(users).toEqual(["invite_as_admin", "invite_as_manager"]);
  });

  it("reports deviations instead of silently changing Extras configurations", async () => {
    const snap = snapshot({
      "catalog:HUESLE:items": {
        "HUESLE-LCO": {
          serviceId: "HUESLE-LCO",
          code: "LCO",
          displayNameDe: "Später Check-out",
          active: "true",
          bookingRule: "departure_day",
          updatedAt: "2026-10-01T10:00:00.000Z",
        },
        "HUESLE-EXTRPERSON": {
          serviceId: "HUESLE-EXTRPERSON",
          code: "EXTRPERSON",
          actionType: "increase_occupancy",
          extraPersonPricePerNight: null,
          requiresRemainingCapacity: "1",
          active: true,
        },
      },
      "extension-night:config:HUESLE": {
        extensionNightEnabled: "true",
        extensionDiscountPreArrivalOneNightGap: "",
        extensionDiscountStandard: 5,
      },
    });
    const result = await run("dry-run", snap);
    const lco = result.items.find((i) => i.sourceKey === "HUESLE:HUESLE-LCO");
    expect(lco?.warnings).toContain("boolean_normalized:active");
    const extra = result.items.find((i) => i.sourceKey === "HUESLE:HUESLE-EXTRPERSON");
    expect(extra?.warnings).toEqual(
      expect.arrayContaining([
        "config_error:missing_extra_person_price",
        "boolean_normalized:requiresRemainingCapacity",
      ]),
    );
    const settings = result.items.find(
      (i) => i.entityType === "property_settings" && i.sourceKey === "HUESLE",
    );
    expect(settings?.warnings).toEqual(
      expect.arrayContaining([
        "boolean_normalized:extensionNightEnabled",
        "empty_discount:extensionDiscountPreArrivalOneNightGap",
        "legacy_discount:extensionDiscountInHouseStandard<-extensionDiscountStandard",
      ]),
    );
    const report = renderImportReport(result, await reconcileExtras(db, up, snap));
    expect(report).toContain("Zusatzperson ohne Preis – in STAY nicht buchbar");
    expect(report).toContain("Leerer Rabatt als 0 % übernommen");
  });

  it("keeps a missing extra-person price as null – never as 0 € (free)", async () => {
    const snap = snapshot({
      "catalog:HUESLE:items": {
        "HUESLE-EXTRPERSON": {
          serviceId: "HUESLE-EXTRPERSON",
          code: "EXTRPERSON",
          actionType: "increase_occupancy",
          extraPersonPricePerNight: "",
          requiresRemainingCapacity: true,
          active: true,
        },
      },
    });
    await run("apply", snap);
    const row = await client.query<{ extra_person_price_cents: number | null }>(
      `SELECT extra_person_price_cents FROM offer_properties WHERE extras_service_id = 'HUESLE-EXTRPERSON'`,
    );
    expect(row.rows).toEqual([{ extra_person_price_cents: null }]);
  });
});
