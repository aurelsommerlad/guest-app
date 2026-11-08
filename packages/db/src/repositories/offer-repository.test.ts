import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database } from "../client";
import { offerMetricsDaily, offers } from "../schema";
import { OFFER_FIXTURE_IDS, offerFixtureInputs, seedOfferFixtures } from "../seed/offer-fixtures";
import { seedTenant } from "../seed/seed-tenant";
import { uniquePlacesSeed } from "../seed/unique-places";
import {
  createTestDatabase,
  expectConstraintViolation,
  type TestDatabase,
} from "../testing/test-database";
import {
  findPropertyOfferBySlug,
  listOfferRequestsForReservation,
  listPropertyOffers,
  recordOfferMetrics,
  summarizeOfferMetrics,
  upsertOffer,
  upsertPartner,
} from "./offer-repository";

const up = { tenantId: "unique-places" };
let db: Database;
let client: TestDatabase["client"];
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, client, close } = await createTestDatabase());
  await seedTenant(db, uniquePlacesSeed);
  // The TEST property is mapped on staging by script N; here it is created the same way.
  await client.query(
    `INSERT INTO properties (id, tenant_id, slug, display_name, spoken_name, location_name, timezone)
     VALUES ('test-run', 'unique-places', 'test-run', 'Test run', 'Test run', 'Testumgebung', 'Europe/Berlin')
     ON CONFLICT DO NOTHING`,
  );
  await seedOfferFixtures(db, up, { withImages: true });
});

afterAll(async () => {
  await close();
});

describe("catalog", () => {
  it("lists own services and partner offers of the property in editorial order", async () => {
    const list = await listPropertyOffers(db, up, "test-run");
    expect(list.map((offer) => offer.id)).toEqual([
      OFFER_FIXTURE_IDS.earlyCheckIn,
      OFFER_FIXTURE_IDS.lateCheckOut,
      OFFER_FIXTURE_IDS.dog,
      OFFER_FIXTURE_IDS.parking,
      OFFER_FIXTURE_IDS.extraPerson,
      OFFER_FIXTURE_IDS.cheese,
      OFFER_FIXTURE_IDS.sunrise,
      OFFER_FIXTURE_IDS.dinner,
    ]);
    const late = list.find((offer) => offer.id === OFFER_FIXTURE_IDS.lateCheckOut);
    expect(late).toMatchObject({ kind: "house-service", extrasServiceId: "TEST-LCO" });
    expect(late?.price).toBeUndefined();
    const cheese = list.find((offer) => offer.id === OFFER_FIXTURE_IDS.cheese);
    expect(cheese).toMatchObject({
      kind: "partner",
      price: { model: "per-person", amountCents: 2400 },
      partner: { name: "Beispiel-Sennerei", commission: { type: "percent", basisPoints: 800 } },
      commission: { type: "percent", basisPoints: 1000 },
      heroImage: { src: "/fixtures/explore/extras-still-life.webp" },
    });
    // Other properties see nothing.
    expect(await listPropertyOffers(db, up, "hov")).toEqual([]);
    expect(await listPropertyOffers(db, { tenantId: "other-tenant" }, "test-run")).toEqual([]);
  });

  it("finds an offer by its slug per locale and hides drafts and inactive partners", async () => {
    expect((await findPropertyOfferBySlug(db, up, "test-run", "late-check-out", "en"))?.id).toBe(
      OFFER_FIXTURE_IDS.lateCheckOut,
    );
    expect(
      (await findPropertyOfferBySlug(db, up, "test-run", "spaeter-auschecken", "en"))?.id,
    ).toBe(OFFER_FIXTURE_IDS.lateCheckOut);
    const [dinner] = offerFixtureInputs(false).filter(
      (input) => input.id === OFFER_FIXTURE_IDS.dinner,
    );
    if (!dinner) throw new Error("fixture");
    await upsertOffer(db, up, { ...dinner, status: "draft" });
    expect((await listPropertyOffers(db, up, "test-run")).map((o) => o.id)).not.toContain(
      OFFER_FIXTURE_IDS.dinner,
    );
    expect(
      (await listPropertyOffers(db, up, "test-run", { statuses: ["draft"] })).map((o) => o.id),
    ).toEqual([OFFER_FIXTURE_IDS.dinner]);
    await upsertOffer(db, up, { ...dinner, status: "published" });
    await upsertPartner(db, up, {
      id: OFFER_FIXTURE_IDS.partnerGuide,
      name: "Beispiel-Bergführer",
      status: "inactive",
      commission: { type: "none" },
    });
    expect((await listPropertyOffers(db, up, "test-run")).map((o) => o.id)).not.toContain(
      OFFER_FIXTURE_IDS.sunrise,
    );
    await upsertPartner(db, up, {
      id: OFFER_FIXTURE_IDS.partnerGuide,
      name: "Beispiel-Bergführer",
      status: "active",
      commission: { type: "fixed", amountCents: 500, currency: "EUR" },
    });
  });

  it("guards the shape in the database as well", async () => {
    await expectConstraintViolation(
      client.query(
        `UPDATE offers SET price = '{"model":"fixed","amountCents":100,"currency":"EUR"}' WHERE id = '${OFFER_FIXTURE_IDS.dog}'`,
      ),
      "offers_kind_shape",
    );
    await expectConstraintViolation(
      client.query(
        `UPDATE offers SET commission = '{"type":"percent"}' WHERE id = '${OFFER_FIXTURE_IDS.cheese}'`,
      ),
      "offers_commission_valid",
    );
    await expectConstraintViolation(
      client.query(
        `UPDATE offers SET cancellation = '{"type":"free-until"}' WHERE id = '${OFFER_FIXTURE_IDS.dog}'`,
      ),
      "offers_cancellation_valid",
    );
    await expectConstraintViolation(
      client.query(
        `UPDATE offers SET booking_url = 'javascript:alert(1)' WHERE id = '${OFFER_FIXTURE_IDS.sunrise}'`,
      ),
      "offers_booking_url_valid",
    );
    await expectConstraintViolation(
      client.query(
        `UPDATE offer_properties SET extras_service_id = 'TEST LCO; DROP' WHERE offer_id = '${OFFER_FIXTURE_IDS.lateCheckOut}'`,
      ),
      "offer_properties_extras_service_id_valid",
    );
    const [row] = await db.select({ count: offers.id }).from(offers).limit(1);
    expect(row).toBeDefined();
  });
});

describe("success measurement", () => {
  it("counts daily totals per offer and placement – nothing per guest", async () => {
    const base = { propertyId: "test-run", offerId: OFFER_FIXTURE_IDS.cheese };
    expect(
      await recordOfferMetrics(
        db,
        up,
        [
          { ...base, placement: "home", event: "impression" },
          { ...base, placement: "home", event: "impression" },
          { ...base, placement: "detail", event: "view" },
          {
            ...base,
            placement: "home",
            event: "booking",
            revenueCents: 4800,
            commission: { type: "percent", basisPoints: 1000 },
          },
          // Not assigned to that property → ignored.
          { ...base, propertyId: "hov", placement: "home", event: "impression" },
          { propertyId: "test-run", offerId: "not-a-uuid", placement: "home", event: "impression" },
        ],
        "2027-01-05",
      ),
    ).toBe(4);
    const rows = await db.select().from(offerMetricsDaily);
    expect(Object.keys(rows[0] ?? {})).not.toEqual(
      expect.arrayContaining(["reservationId", "sessionId", "ip"]),
    );
    const summary = await summarizeOfferMetrics(db, up, { from: "2027-01-01", to: "2027-01-31" });
    const home = summary.find((row) => row.placement === "home");
    expect(home).toMatchObject({
      impressions: 2,
      bookings: 1,
      revenueCents: 4800,
      commissionCents: 480,
    });
    expect(summary.find((row) => row.placement === "detail")).toMatchObject({ views: 1 });
    expect(
      await summarizeOfferMetrics(
        db,
        { tenantId: "other-tenant" },
        { from: "2027-01-01", to: "2027-01-31" },
      ),
    ).toEqual([]);
  });
});

describe("requests (prepared)", () => {
  it("returns no requests for a reservation without any", async () => {
    expect(
      await listOfferRequestsForReservation(db, up, {
        reservationProvider: "apaleo",
        externalReservationId: "JTKQSYFX-1",
      }),
    ).toEqual([]);
  });
});
