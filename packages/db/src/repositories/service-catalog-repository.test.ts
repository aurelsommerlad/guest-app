import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database } from "../client";
import { seedTenant } from "../seed/seed-tenant";
import { uniquePlacesSeed } from "../seed/unique-places";
import {
  createTestDatabase,
  expectConstraintViolation,
  type TestDatabase,
} from "../testing/test-database";
import { createAdminUser } from "./admin-repository";
import { listAdminAuditEvents } from "./audit-repository";
import { listPropertyOffers } from "./offer-repository";
import {
  decideOfferRequest,
  getOfferRequestForAdmin,
  listOfferRequestsForAdmin,
  listServiceBookings,
  listStayExtensions,
} from "./operations-repository";
import {
  type CatalogOfferInput,
  createCatalogOffer,
  getCatalogOffer,
  listCatalogOffers,
  type PropertyConfigInput,
  removePropertyConfig,
  savePropertyConfig,
  setCatalogOfferStatus,
  updateCatalogOffer,
} from "./service-catalog-repository";

const up = { tenantId: "unique-places" };
const other = { tenantId: "other-tenant" };
const now = new Date("2026-11-08T12:00:00Z");

let db: Database;
let client: TestDatabase["client"];
let close: () => Promise<void>;
let actor: string;
let offerId: string;

const offerInput: CatalogOfferInput = {
  title: { de: "Später Check-out", en: "Late check-out" },
  teaser: { de: "Bis 14 Uhr", en: "Until 2 pm" },
  body: null,
  details: null,
  category: "arrival-departure",
  fulfillment: "instant",
  cancellation: { type: "non-refundable" },
  heroImage: null,
  slug: { de: "spaeter-check-out", en: "late-check-out" },
};

const config = (overrides: Partial<PropertyConfigInput> = {}): PropertyConfigInput => ({
  extrasServiceId: "ALTUS-LCO",
  active: true,
  sortOrder: 1,
  actionType: "service",
  bookingRule: "departure_day",
  fulfillment: "instant",
  extraPersonPriceCents: null,
  priceUnitLabel: null,
  requiresRemainingCapacity: false,
  requiresVehicleRegistration: false,
  maxOnePerReservation: false,
  allowedUnitGroupIds: [],
  titleOverride: null,
  teaserOverride: null,
  ...overrides,
});

beforeAll(async () => {
  ({ db, client, close } = await createTestDatabase());
  await seedTenant(db, uniquePlacesSeed);
  await client.query(
    `INSERT INTO tenants (id, slug, name) VALUES ('other-tenant', 'other-tenant', 'Other')`,
  );
  actor = (
    await createAdminUser(db, up, {
      email: "owner@example.test",
      passwordHash: "scrypt$x",
      role: "owner",
    })
  ).id;
});

afterAll(async () => {
  await close();
});

describe("service catalog", () => {
  it("creates a central offer as draft and configures it per property", async () => {
    offerId = await createCatalogOffer(db, up, { ...offerInput, actorAdminId: actor });
    expect(
      await savePropertyConfig(db, up, {
        offerId,
        propertyId: "hov",
        config: config(),
        actorAdminId: actor,
        now,
      }),
    ).toEqual({
      ok: true,
      created: true,
    });
    expect(
      await savePropertyConfig(db, up, {
        offerId,
        propertyId: "huesle",
        config: config({ extrasServiceId: "HUESLE-LCO", active: false, sortOrder: 3 }),
        actorAdminId: actor,
        now,
      }),
    ).toMatchObject({ ok: true });
    const offer = await getCatalogOffer(db, up, offerId);
    expect(offer).toMatchObject({
      status: "draft",
      properties: [{ propertyId: "hov" }, { propertyId: "huesle", active: false }],
    });
  });

  it("filters configurations for property-limited admins", async () => {
    const limited = await listCatalogOffers(db, up, { propertyIds: ["huesle"] });
    expect(limited).toHaveLength(1);
    expect(limited[0]?.properties.map((p) => p.propertyId)).toEqual(["huesle"]);
    expect(await listCatalogOffers(db, up, { propertyIds: ["laeke"] })).toEqual([]);
  });

  it("assigns an Apaleo service to only one offer per property", async () => {
    const second = await createCatalogOffer(db, up, { ...offerInput, actorAdminId: actor });
    expect(
      await savePropertyConfig(db, up, {
        offerId: second,
        propertyId: "hov",
        config: config(),
        actorAdminId: actor,
        now,
      }),
    ).toEqual({
      ok: false,
      reason: "service-in-use",
    });
  });

  it("enforces the occupancy rule in the database (no free additional guests by accident)", async () => {
    const extra = await createCatalogOffer(db, up, { ...offerInput, actorAdminId: actor });
    await expectConstraintViolation(
      savePropertyConfig(db, up, {
        offerId: extra,
        propertyId: "hov",
        config: config({
          extrasServiceId: "ALTUS-EXTRA",
          actionType: "increase_occupancy",
          fulfillment: "request",
        }),
        actorAdminId: actor,
        now,
      }),
      "offer_properties_occupancy_shape",
    );
  });

  it("hides inactive property configurations from guests and shows published ones", async () => {
    await setCatalogOfferStatus(db, up, { offerId, status: "published", actorAdminId: actor, now });
    expect((await listPropertyOffers(db, up, "hov")).some((o) => o.id === offerId)).toBe(true);
    expect((await listPropertyOffers(db, up, "huesle")).some((o) => o.id === offerId)).toBe(false);
  });

  it("audits changes with field names only and isolates tenants", async () => {
    await updateCatalogOffer(db, up, offerId, {
      ...offerInput,
      teaser: { de: "Bis 15 Uhr", en: "Until 3 pm" },
      actorAdminId: actor,
    });
    await savePropertyConfig(db, up, {
      offerId,
      propertyId: "hov",
      config: config({ sortOrder: 2 }),
      actorAdminId: actor,
      now,
    });
    const events = await listAdminAuditEvents(db, up);
    expect(events.find((e) => e.action === "catalog.offer_updated")?.details).toEqual({
      changedFields: ["teaser"],
    });
    expect(events.find((e) => e.action === "catalog.property_config_updated")?.details).toEqual({
      changedFields: ["sortOrder"],
    });
    expect(await getCatalogOffer(db, other, offerId)).toBeUndefined();
    expect(
      await updateCatalogOffer(db, other, offerId, { ...offerInput, actorAdminId: actor }),
    ).toBe(false);
    expect(
      await removePropertyConfig(db, other, { offerId, propertyId: "hov", actorAdminId: actor }),
    ).toBe(false);
    expect(
      (
        await savePropertyConfig(db, other, {
          offerId,
          propertyId: "hov",
          config: config(),
          actorAdminId: actor,
          now,
        })
      ).ok,
    ).toBe(false);
  });

  it("removes an offer from one property", async () => {
    expect(
      await removePropertyConfig(db, up, { offerId, propertyId: "huesle", actorAdminId: actor }),
    ).toBe(true);
    expect((await getCatalogOffer(db, up, offerId))?.properties.map((p) => p.propertyId)).toEqual([
      "hov",
    ]);
  });
});

describe("operations", () => {
  let stayRequest: string;
  let extrasRequest: string;

  beforeAll(async () => {
    const insert = async (source: string, legacy: string | null, property = "hov") =>
      (
        await client.query<{ id: string }>(
          `INSERT INTO offer_requests (tenant_id, offer_id, property_id, reservation_provider, external_reservation_id, source, legacy_id, quantity, apaleo_service_id)
           VALUES ('unique-places', $1, $2, 'apaleo', 'ABCDEF-1', $3, $4, 1, 'ALTUS-LCO') RETURNING id`,
          [offerId, property, source, legacy],
        )
      ).rows[0]?.id ?? "";
    stayRequest = await insert("stay", null);
    extrasRequest = await insert("extras", "r-1");
    await insert("stay", null, "laeke");
    await client.query(
      `INSERT INTO service_bookings (tenant_id, property_id, reservation_provider, external_reservation_id, status, source)
       VALUES ('unique-places', 'hov', 'apaleo', 'ABCDEF-1', 'completed', 'extras'), ('unique-places', 'laeke', 'apaleo', 'XYZ-1', 'completed', 'stay')`,
    );
    await client.query(
      `INSERT INTO stay_extensions (tenant_id, property_id, reservation_provider, external_reservation_id, old_departure, new_departure, status)
       VALUES ('unique-places', 'hov', 'apaleo', 'ABCDEF-1', '2026-10-12', '2026-10-13', 'confirmed')`,
    );
  });

  it("lists per property for limited admins", async () => {
    expect((await listOfferRequestsForAdmin(db, up)).length).toBe(3);
    expect((await listOfferRequestsForAdmin(db, up, { propertyIds: ["hov"] })).length).toBe(2);
    expect(
      (await listServiceBookings(db, up, { propertyIds: ["laeke"] })).map((b) => b.propertyId),
    ).toEqual(["laeke"]);
    expect((await listStayExtensions(db, up, { propertyIds: ["huesle"] })).length).toBe(0);
    expect(await listOfferRequestsForAdmin(db, other)).toEqual([]);
  });

  it("decides a pending STAY request once; Extras requests stay with Extras", async () => {
    const decide = () =>
      decideOfferRequest(db, up, {
        requestId: stayRequest,
        decision: "declined",
        actorAdminId: actor,
        now,
      });
    const [a, b] = await Promise.all([decide(), decide()]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect((await getOfferRequestForAdmin(db, up, stayRequest))?.status).toBe("declined");
    expect(
      await decideOfferRequest(db, up, {
        requestId: extrasRequest,
        decision: "declined",
        actorAdminId: actor,
        now,
      }),
    ).toEqual({
      ok: false,
      reason: "handled-in-extras",
    });
    expect((await getOfferRequestForAdmin(db, up, extrasRequest))?.status).toBe("pending");
  });
});
