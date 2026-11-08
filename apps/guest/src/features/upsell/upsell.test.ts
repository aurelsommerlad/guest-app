/**
 * "Services & Erlebnisse" (Phase 1) against the real repository (PGlite) with the TEST demo
 * content: catalog per stay, home selection, view model, price texts and the privacy-friendly
 * counters. Nothing leaves the process.
 */
import { createLogger } from "@up/core";
import {
  type Database,
  OFFER_FIXTURE_IDS,
  seedOfferFixtures,
  seedTenant,
  summarizeOfferMetrics,
  uniquePlacesSeed,
} from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import de from "../../../messages/de.json";
import { findPropertyById } from "../../config/properties";
import { formatCancellation, formatDuration, formatOfferPrice } from "../../v2/upsell/format";
import { guestContext } from "../check-in/test-context";
import { type GuestContext } from "../guest-context/guest-context";
import { type StayJourney } from "../journey/stay-journey";
import { previewHouseServiceSource } from "./house-services";
import { recordReportedOfferEvents } from "./metrics-service";
import { homeRecommendations, loadOfferCatalog, type UpsellDeps } from "./upsell-service";

const up = { tenantId: "unique-places" };
let db: Database;
let client: TestDatabase["client"];
let close: () => Promise<void>;
let deps: UpsellDeps;

function testRunContext(overrides: Partial<GuestContext> = {}): GuestContext {
  const property = findPropertyById("test-run");
  if (!property) throw new Error("test-run missing");
  return guestContext({ propertyId: "test-run", property, ...overrides });
}

/** Only what the catalog reads from the journey. */
function journey(phase: StayJourney["journey"]["phase"]): StayJourney {
  return {
    journey: { phase },
    arrivalDate: "2026-08-27",
    window: {
      checkInAt: "2026-08-27T16:00:00+02:00",
      checkOutAt: "2026-08-31T10:00:00+02:00",
      timeZone: "Europe/Berlin",
    },
  } as unknown as StayJourney;
}

beforeAll(async () => {
  ({ db, client, close } = await createTestDatabase());
  await seedTenant(db, uniquePlacesSeed);
  await client.query(
    `INSERT INTO properties (id, tenant_id, slug, display_name, spoken_name, location_name, timezone)
     VALUES ('test-run', 'unique-places', 'test-run', 'Test run', 'Test run', 'Testumgebung', 'Europe/Berlin')
     ON CONFLICT DO NOTHING`,
  );
  await seedOfferFixtures(db, up, { withImages: false });
  deps = {
    db,
    logger: createLogger({ level: "error", sink: () => undefined }),
    houseServices: previewHouseServiceSource,
  };
});

afterAll(async () => {
  await close();
});

describe("offer catalog", () => {
  it("is only loaded where the feature is switched on (TEST + V2)", async () => {
    expect(await loadOfferCatalog(deps, guestContext(), journey("before-arrival"), "de")).toBe(
      undefined,
    );
  });

  it("lists own services and partner offers with prices from the right source", async () => {
    const catalog = await loadOfferCatalog(deps, testRunContext(), journey("before-arrival"), "de");
    expect(catalog?.offers.map((offer) => offer.chapter)).toEqual([
      "stay",
      "stay",
      "stay",
      "stay",
      "stay",
      "region",
      "region",
      "region",
    ]);
    const early = catalog?.offers.find((offer) => offer.id === OFFER_FIXTURE_IDS.earlyCheckIn);
    expect(early).toMatchObject({
      href: "/v2/services/frueher-einchecken",
      price: { kind: "amount", amountCents: 2000, per: "stay", from: false },
      pricePreview: true,
      fulfillment: "instant",
    });
    expect(early?.image).toBeUndefined();
    const parking = catalog?.offers.find((offer) => offer.id === OFFER_FIXTURE_IDS.parking);
    expect(parking?.price).toEqual({ kind: "at-booking" });
    const cheese = catalog?.offers.find((offer) => offer.id === OFFER_FIXTURE_IDS.cheese);
    expect(cheese).toMatchObject({
      kind: "partner",
      price: { kind: "amount", amountCents: 2400, per: "person" },
      pricePreview: false,
      partnerName: expect.any(String) as string,
    });
    expect(catalog?.booked).toEqual([]);
  });

  it("follows the stay's phase and the locale", async () => {
    const catalog = await loadOfferCatalog(deps, testRunContext(), journey("in-stay"), "en");
    const ids = catalog?.offers.map((offer) => offer.id) ?? [];
    expect(ids).not.toContain(OFFER_FIXTURE_IDS.earlyCheckIn);
    expect(ids).not.toContain(OFFER_FIXTURE_IDS.dog);
    expect(ids).toContain(OFFER_FIXTURE_IDS.lateCheckOut);
    expect(catalog?.offers.find((o) => o.id === OFFER_FIXTURE_IDS.lateCheckOut)?.href).toBe(
      "/v2/services/late-check-out",
    );
  });

  it("recommends few offers for the home page, one per category, focus phase first", async () => {
    const catalog = await loadOfferCatalog(deps, testRunContext(), journey("before-arrival"), "de");
    if (!catalog) throw new Error("catalog missing");
    const picks = homeRecommendations(catalog);
    expect(picks).toHaveLength(3);
    expect(picks[0]?.id).toBe(OFFER_FIXTURE_IDS.earlyCheckIn);
    expect(new Set(picks.map((offer) => offer.category)).size).toBe(3);
  });
});

describe("price and fact texts", () => {
  const t = createTranslator({ locale: "de", messages: de, namespace: "services" });
  // Intl separates amount and currency with a no-break space.
  const plain = (text: string) => text.replace(/\u00a0/g, " ");

  it("are quiet text: whole euros, per unit, from, on request", () => {
    const amount = (per: "stay" | "night" | "person" | "person-night", from = false) =>
      plain(
        formatOfferPrice(
          { kind: "amount", amountCents: 2400, currency: "EUR", per, from },
          t,
          "de",
        ),
      );
    expect(amount("stay")).toBe("24 €");
    expect(amount("night")).toBe("24 € pro Nacht");
    expect(amount("person")).toBe("24 € pro Person");
    expect(amount("stay", true)).toBe("ab 24 €");
    expect(
      plain(
        formatOfferPrice(
          { kind: "amount", amountCents: 1950, currency: "EUR", per: "stay", from: false },
          t,
          "de",
        ),
      ),
    ).toBe("19,50 €");
    expect(formatOfferPrice({ kind: "on-request" }, t, "de")).toBe("Preis auf Anfrage");
    expect(formatDuration(150, t)).toBe("2 Stunden 30 Minuten");
    expect(formatDuration(60, t)).toBe("1 Stunde");
    expect(formatCancellation({ type: "free-until", hoursBefore: 48 }, t)).toBe(
      "Kostenfrei bis 2 Tage vorher",
    );
    expect(formatCancellation({ type: "free-until", hoursBefore: 24 }, t)).toBe(
      "Kostenfrei bis 24 Stunden vorher",
    );
  });
});

describe("measurement", () => {
  it("counts daily totals only for offers shown to this stay and client-reportable events", async () => {
    const now = () => new Date("2026-08-20T10:00:00+02:00");
    const recorded = await recordReportedOfferEvents(
      { ...deps, now },
      testRunContext(),
      journey("before-arrival"),
      [
        { offerId: OFFER_FIXTURE_IDS.earlyCheckIn, event: "impression", placement: "home" },
        { offerId: OFFER_FIXTURE_IDS.earlyCheckIn, event: "impression", placement: "home" },
        { offerId: OFFER_FIXTURE_IDS.sunrise, event: "click-out", placement: "detail" },
        // Dropped: not reportable from the browser, unknown placement, unknown offer, junk.
        { offerId: OFFER_FIXTURE_IDS.cheese, event: "booking", placement: "detail" },
        { offerId: OFFER_FIXTURE_IDS.cheese, event: "view", placement: "elsewhere" },
        { offerId: "11111111-1111-4111-8111-111111111111", event: "view", placement: "detail" },
        "junk",
        null,
      ],
    );
    expect(recorded).toBeGreaterThan(0);
    const rows = await summarizeOfferMetrics(db, up, {
      from: "2026-08-20",
      to: "2026-08-20",
      propertyId: "test-run",
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.offerId === OFFER_FIXTURE_IDS.earlyCheckIn)).toMatchObject({
      placement: "home",
      impressions: 2,
    });
    expect(rows.find((row) => row.offerId === OFFER_FIXTURE_IDS.sunrise)).toMatchObject({
      placement: "detail",
      clickOuts: 1,
    });
    // No reservation, session or guest reference in the counters.
    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'offer_metrics_daily'`,
    );
    expect(columns.rows.map((row) => row.column_name).join(",")).not.toMatch(
      /reservation|guest|session|ip/,
    );
  });

  it("ignores input that is not a list", async () => {
    const now = () => new Date("2026-08-20T10:00:00+02:00");
    expect(
      await recordReportedOfferEvents({ ...deps, now }, testRunContext(), journey("in-stay"), {
        offerId: OFFER_FIXTURE_IDS.sunrise,
      }),
    ).toBe(0);
  });
});
