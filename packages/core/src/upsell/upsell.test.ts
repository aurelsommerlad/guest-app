import { describe, expect, it } from "vitest";

import { isOfferAvailable } from "./availability";
import { sortBookedItems, takenOfferIds, type BookedItem } from "./booked-overview";
import { metricDelta, metricRates } from "./metrics";
import {
  chapterOf,
  commissionCents,
  DEFAULT_AVAILABILITY,
  effectiveCommission,
  type PropertyOffer,
} from "./offer-model";
import { offerSchema, partnerSchema } from "./offer-schema";
import { selectRecommendations } from "./recommendation";

function offer(id: string, patch: Partial<PropertyOffer> = {}): PropertyOffer {
  return {
    id,
    tenantId: "unique-places",
    kind: "house-service",
    category: "arrival-departure",
    status: "published",
    slug: { de: id },
    title: { de: id },
    teaser: { de: id },
    gallery: [],
    fulfillment: "instant",
    cancellation: { type: "free-until", hoursBefore: 24 },
    availability: DEFAULT_AVAILABILITY,
    featured: false,
    sortOrder: 0,
    translationState: {},
    propertyId: "test-run",
    propertySortOrder: 0,
    ...patch,
  };
}

const stay = { phase: "before-arrival" as const, today: "2027-01-05", arrivalDate: "2027-01-12" };

describe("availability", () => {
  it("respects phases, seasons, weekdays and the earliest showing day", () => {
    expect(isOfferAvailable(DEFAULT_AVAILABILITY, stay)).toBe(true);
    expect(isOfferAvailable(DEFAULT_AVAILABILITY, { ...stay, phase: "after-departure" })).toBe(
      false,
    );
    expect(isOfferAvailable({ ...DEFAULT_AVAILABILITY, phases: ["in-stay"] }, stay)).toBe(false);
    // Winter season wrapping the year.
    const winter = { ...DEFAULT_AVAILABILITY, seasons: [{ from: "12-01", to: "03-31" }] };
    expect(isOfferAvailable(winter, stay)).toBe(true);
    expect(isOfferAvailable(winter, { ...stay, today: "2027-07-01" })).toBe(false);
    // 2027-01-05 is a Tuesday (2).
    expect(isOfferAvailable({ ...DEFAULT_AVAILABILITY, weekdays: [2] }, stay)).toBe(true);
    expect(isOfferAvailable({ ...DEFAULT_AVAILABILITY, weekdays: [6, 7] }, stay)).toBe(false);
    const late = { ...DEFAULT_AVAILABILITY, showFromDaysBeforeArrival: 3 };
    expect(isOfferAvailable(late, stay)).toBe(false);
    expect(isOfferAvailable(late, { ...stay, today: "2027-01-10" })).toBe(true);
    expect(isOfferAvailable(late, { ...stay, phase: "in-stay", today: "2027-01-13" })).toBe(true);
  });
});

describe("recommendations", () => {
  const offers = [
    offer("late-checkout", {
      category: "arrival-departure",
      availability: { ...DEFAULT_AVAILABILITY, focusPhases: ["in-stay", "departure-day"] },
    }),
    offer("early-checkin", {
      category: "arrival-departure",
      availability: { ...DEFAULT_AVAILABILITY, focusPhases: ["before-arrival", "arrival-day"] },
    }),
    offer("parking", { category: "mobility", sortOrder: 2 }),
    offer("dog", { category: "pets", sortOrder: 3 }),
    offer("dinner", {
      kind: "partner",
      category: "food-drink",
      fulfillment: "request",
      featured: true,
    }),
    offer("draft", { status: "draft", category: "comfort", featured: true }),
  ];

  it("chooses few offers, one per category, by phase", () => {
    const before = selectRecommendations(offers, stay).map((r) => r.offer.id);
    expect(before).toHaveLength(3);
    expect(before[0]).toBe("early-checkin");
    expect(before).not.toContain("late-checkout"); // same category as early check-in
    expect(before).not.toContain("draft");
    const during = selectRecommendations(offers, {
      ...stay,
      phase: "in-stay",
      today: "2027-01-13",
    });
    expect(during[0]?.offer.id).toBe("late-checkout");
    // Partner experience wins the tie during the stay.
    expect(during[1]?.offer.id).toBe("dinner");
    expect(selectRecommendations(offers, stay, 1)).toHaveLength(1);
  });

  it("never recommends what was already booked or requested", () => {
    const taken = new Set(["early-checkin"]);
    const ids = selectRecommendations(offers, { ...stay, takenOfferIds: taken }).map(
      (r) => r.offer.id,
    );
    expect(ids).not.toContain("early-checkin");
    // The arrival/departure category is free again for the late check-out.
    expect(ids).toContain("late-checkout");
  });
});

describe("commission and metrics", () => {
  it("computes percentage, fixed and no commission", () => {
    expect(commissionCents({ type: "none" }, 10_000)).toBe(0);
    expect(commissionCents({ type: "percent", basisPoints: 1250 }, 8_999)).toBe(1125);
    expect(commissionCents({ type: "fixed", amountCents: 500, currency: "EUR" }, 8_999)).toBe(500);
    expect(() => commissionCents({ type: "none" }, -1)).toThrow();
    expect(
      effectiveCommission({
        partner: { id: "p", name: "P", commission: { type: "percent", basisPoints: 1000 } },
      }),
    ).toEqual({ type: "percent", basisPoints: 1000 });
    expect(
      effectiveCommission({
        commission: { type: "none" },
        partner: { id: "p", name: "P", commission: { type: "percent", basisPoints: 1000 } },
      }),
    ).toEqual({ type: "none" });
  });

  it("turns events into counter deltas without any personal data", () => {
    const base = { offerId: "o", propertyId: "test-run", placement: "home" as const };
    expect(metricDelta({ ...base, event: "impression" })).toMatchObject({
      impressions: 1,
      views: 0,
    });
    expect(
      metricDelta({
        ...base,
        event: "booking",
        revenueCents: 4_000,
        commission: { type: "percent", basisPoints: 1000 },
      }),
    ).toMatchObject({ bookings: 1, revenueCents: 4_000, commissionCents: 400 });
    expect(() => metricDelta({ ...base, event: "view", revenueCents: 1 })).toThrow();
    expect(() => metricDelta({ ...base, event: "booking", revenueCents: 1.5 })).toThrow();
    expect(
      metricRates({
        impressions: 10,
        views: 4,
        clickOuts: 0,
        requests: 1,
        bookings: 1,
        revenueCents: 2000,
        commissionCents: 0,
      }),
    ).toMatchObject({ viewRate: 0.4, requestRate: 0.25, revenuePerView: 500 });
    expect(
      metricRates({
        impressions: 0,
        views: 0,
        clickOuts: 0,
        requests: 0,
        bookings: 0,
        revenueCents: 0,
        commissionCents: 0,
      }).viewRate,
    ).toBeUndefined();
  });
});

describe("booked overview", () => {
  it("lists open requests first and marks taken offers", () => {
    const items: BookedItem[] = [
      {
        id: "1",
        source: "apaleo",
        status: "booked",
        title: "Parkplatz",
        date: "2027-01-12",
        offerId: "parking",
        payment: "folio",
      },
      {
        id: "2",
        source: "partner-request",
        status: "requested",
        title: "Dinner",
        offerId: "dinner",
        payment: "partner",
      },
      {
        id: "3",
        source: "partner-request",
        status: "declined",
        title: "Kurs",
        offerId: "course",
        payment: "none",
      },
    ];
    expect(sortBookedItems(items).map((item) => item.id)).toEqual(["2", "1", "3"]);
    expect([...takenOfferIds(items)].sort()).toEqual(["dinner", "parking"]);
  });
});

describe("validation", () => {
  const allowed = (src: string) => src.startsWith("/fixtures/");
  const base = {
    kind: "partner" as const,
    partnerId: "6f1d1a4e-0e3c-4c0f-9a51-2a9b3c4d5e6f",
    category: "food-drink" as const,
    title: { de: "Abendessen" },
    slug: { de: "abendessen" },
    teaser: { de: "Ein Abend am Kamin." },
    gallery: [],
    fulfillment: "request" as const,
    price: { model: "per-person" as const, amountCents: 6_500, currency: "EUR" },
    cancellation: { type: "partner-terms" as const },
    availability: DEFAULT_AVAILABILITY,
    featured: false,
    sortOrder: 0,
    properties: [{ propertyId: "test-run", sortOrder: 0 }],
  };

  it("accepts a complete partner offer and own services without price or partner", () => {
    expect(offerSchema(allowed).safeParse(base).success).toBe(true);
    const own = {
      ...base,
      kind: "house-service",
      category: "pets",
      fulfillment: "instant",
      price: undefined,
      partnerId: undefined,
      cancellation: { type: "free-until", hoursBefore: 48 },
      properties: [{ propertyId: "test-run", extrasServiceId: "TEST-DOG", sortOrder: 1 }],
    };
    expect(offerSchema(allowed).safeParse(own).success).toBe(true);
    expect(chapterOf("house-service")).toBe("stay");
    expect(chapterOf("partner")).toBe("region");
  });

  it("refuses mixed-up kinds, prices for own services and unsafe links or images", () => {
    const parse = (patch: object) => offerSchema(allowed).safeParse({ ...base, ...patch }).success;
    expect(parse({ category: "pets" })).toBe(false);
    expect(parse({ fulfillment: "instant" })).toBe(false);
    expect(parse({ fulfillment: "link" })).toBe(false); // no URL
    expect(parse({ fulfillment: "link", bookingUrl: "javascript:alert(1)" })).toBe(false);
    expect(parse({ partnerId: undefined })).toBe(false);
    expect(
      parse({
        kind: "house-service",
        category: "pets",
        fulfillment: "instant",
        partnerId: undefined,
      }),
    ).toBe(false); // price set
    expect(
      parse({
        heroImage: { src: "https://evil.example/x.jpg", width: 10, height: 10, alt: { de: "x" } },
      }),
    ).toBe(false);
    expect(parse({ commission: { type: "percent", basisPoints: 9000 } })).toBe(false);
    expect(
      partnerSchema.safeParse({ name: "<b>X</b>", status: "active", commission: { type: "none" } })
        .success,
    ).toBe(false);
    expect(
      partnerSchema.safeParse({
        name: "Sennerei",
        status: "active",
        commission: { type: "fixed", amountCents: 300, currency: "EUR" },
      }).success,
    ).toBe(true);
  });
});
