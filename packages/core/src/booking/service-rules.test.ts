/**
 * 1:1 port of the Extras reference tests (aurelsommerlad/guest-services, test/*.test.mjs) for the
 * pure booking rules in service-rules.ts. Each `describe` names the source file, each `it` keeps
 * the original test name. Extras tests that exercise I/O (bookService with a mocked fetch,
 * approveRequest against the Apaleo simulator) and UI helpers (resizeVehiclePlates) are not
 * ported – see the report in the PR.
 */
import { describe, expect, it } from "vitest";

import {
  type ApaleoBookedService,
  type ApaleoServiceOffer,
  buildExtraPersonPricing,
  buildOccupancyAmendmentPayload,
  buildPrimaryVehicleRegistration,
  compareBySortOrder,
  compareExistingBooking,
  computePriceBreakdown,
  countBookedServiceQuantity,
  datesWithoutAvailability,
  DEFAULT_PRICE_UNIT_LABELS,
  DEFAULT_VEHICLE_COUNTRY_CODE,
  formatVehiclePlatesComment,
  getAdultsCount,
  getChildrenCount,
  getRemainingCapacity,
  getReservationUnitGroupId,
  getTotalOccupancy,
  getUnitGroupMaxOccupancy,
  hasCompleteVehiclePlates,
  hasReachedDogLimit,
  isUnitGroupAllowed,
  MAX_DOGS_PER_RESERVATION,
  normalizeVehiclePlates,
  resolveBilingualPriceUnitLabel,
  resolveBilingualText,
  resolvePriceUnitLabel,
  type TimeSliceLike,
} from "./service-rules";

/* ── capacity.test.mjs ───────────────────────────────────────────────────────────────── */

describe("capacity.test.mjs", () => {
  it("getUnitGroupMaxOccupancy: reads maxPersons from a real Apaleo unit-group shape", () => {
    const unitGroup = { id: "LAEKE-AP_L", maxPersons: 5 };
    expect(getUnitGroupMaxOccupancy(unitGroup)).toBe(5);
  });

  it("getUnitGroupMaxOccupancy: missing/invalid maxPersons resolves to null", () => {
    expect(getUnitGroupMaxOccupancy({})).toBeNull();
    expect(getUnitGroupMaxOccupancy(null)).toBeNull();
    expect(getUnitGroupMaxOccupancy({ maxPersons: "not-a-number" })).toBeNull();
  });

  it("getRemainingCapacity: capacity available for an adult-only reservation", () => {
    // Apartment capacity 4, reservation 2 adults -> remaining 2 -> extra shown.
    const remaining = getRemainingCapacity({ maxPersons: 4 }, { adults: 2 });
    expect(remaining).toBe(2);
    expect(remaining).toBeGreaterThan(0);
  });

  it("getRemainingCapacity: capacity available for a reservation with children (task's worked example)", () => {
    // Apartment capacity 4, reservation 2 adults + 1 child -> remaining 1.
    expect(getRemainingCapacity({ maxPersons: 4 }, { adults: 2, childrenAges: [7] })).toBe(1);
  });

  it("getRemainingCapacity: no capacity left (task's worked example) -> extra hidden", () => {
    // Apartment capacity 4, reservation 2 adults + 2 children -> remaining 0.
    expect(getRemainingCapacity({ maxPersons: 4 }, { adults: 2, childrenAges: [5, 9] })).toBe(0);
  });

  it("getRemainingCapacity: remainingCapacity of 1 -> max selectable quantity is 1", () => {
    expect(getRemainingCapacity({ maxPersons: 3 }, { adults: 2 })).toBe(1);
  });

  it("getRemainingCapacity: remainingCapacity of 2 -> max selectable quantity is 2", () => {
    expect(getRemainingCapacity({ maxPersons: 4 }, { adults: 2 })).toBe(2);
  });

  it("getRemainingCapacity: an already-over-capacity reservation floors at 0, never negative", () => {
    expect(getRemainingCapacity({ maxPersons: 4 }, { adults: 3, childrenAges: [2, 4] })).toBe(0);
  });

  it("getRemainingCapacity: fails closed to 0 when the unit group can't be resolved at all", () => {
    expect(getRemainingCapacity(null, { adults: 1 })).toBe(0);
    expect(getRemainingCapacity({}, { adults: 1 })).toBe(0);
  });

  it("getRemainingCapacity: unrelated fields (allowedUnitGroupIds, availableCount) on the inputs never affect the result", () => {
    // The capacity check is orthogonal to unit-group restriction and Apaleo service-offer
    // availability — those are separate gates that combine with, but never interfere with, it.
    const unitGroup = { maxPersons: 4, allowedUnitGroupIds: ["some-other-id"] };
    const reservation = { adults: 2, childrenAges: [7], availableCount: 0 };
    expect(getRemainingCapacity(unitGroup, reservation)).toBe(1);
  });
});

/* ── occupancy.test.mjs ──────────────────────────────────────────────────────────────── */

describe("occupancy.test.mjs", () => {
  it("getAdultsCount: reads the reservation's adults field", () => {
    expect(getAdultsCount({ adults: 2 })).toBe(2);
    expect(getAdultsCount({ adults: 4 })).toBe(4);
  });

  it("getAdultsCount: missing adults defaults to 0, not NaN", () => {
    expect(getAdultsCount({})).toBe(0);
    expect(getAdultsCount(null)).toBe(0);
    expect(getAdultsCount(undefined)).toBe(0);
  });

  it("getChildrenCount: derives from childrenAges.length, per the real Apaleo shape", () => {
    expect(getChildrenCount({ childrenAges: [10, 12] })).toBe(2);
    expect(getChildrenCount({ childrenAges: [5] })).toBe(1);
    expect(getChildrenCount({ childrenAges: [] })).toBe(0);
  });

  it("getChildrenCount: no childrenAges at all means 0 children", () => {
    expect(getChildrenCount({ adults: 2 })).toBe(0);
    expect(getChildrenCount({})).toBe(0);
  });

  it("getTotalOccupancy: an adult-only reservation counts only the adults", () => {
    expect(getTotalOccupancy({ adults: 2 })).toBe(2);
    expect(getTotalOccupancy({ adults: 4, childrenAges: [] })).toBe(4);
  });

  it("getTotalOccupancy: a reservation with children counts every child the same as an adult", () => {
    // 2 adults + 2 children fills a capacity-4 unit group exactly — every guest counts as 1.
    expect(getTotalOccupancy({ adults: 2, childrenAges: [5, 7] })).toBe(4);
    expect(getTotalOccupancy({ adults: 2, childrenAges: [7] })).toBe(3);
  });
});

/* ── occupancy-amendment.test.mjs ────────────────────────────────────────────────────── */

describe("occupancy-amendment.test.mjs", () => {
  function reservation(overrides: Record<string, unknown> = {}) {
    return {
      arrival: "2026-09-01",
      departure: "2026-09-05",
      adults: 2,
      childrenAges: [7],
      ...overrides,
    };
  }

  function slice(ratePlanId: string, amount: number, currency = "EUR"): TimeSliceLike {
    return { ratePlan: { id: ratePlanId }, totalGrossAmount: { amount, currency } };
  }

  it("buildExtraPersonPricing: task's worked example (30 EUR/night x 4 nights x 1 person)", () => {
    const pricing = buildExtraPersonPricing({ pricePerNight: 30, nights: 4 });
    expect(pricing?.unitPrice).toEqual({ amount: 30, currency: "EUR" });
    expect(pricing?.nights).toBe(4);
    expect(pricing?.price).toEqual({ amount: 120, currency: "EUR" });
  });

  it("buildExtraPersonPricing: rounds to 2 decimals", () => {
    expect(buildExtraPersonPricing({ pricePerNight: 33.333, nights: 3 })?.price.amount).toBe(100);
  });

  it("buildExtraPersonPricing: custom currency is passed through", () => {
    const pricing = buildExtraPersonPricing({ pricePerNight: 30, nights: 2, currency: "CHF" });
    expect(pricing?.unitPrice.currency).toBe("CHF");
    expect(pricing?.price.currency).toBe("CHF");
  });

  it("buildExtraPersonPricing: refuses invalid price or nights rather than guessing", () => {
    const cases: [unknown, number][] = [
      [-1, 4],
      ["not-a-number", 4],
      [30, 0],
      [30, -1],
      [30, NaN],
    ];
    for (const [pricePerNight, nights] of cases) {
      expect(buildExtraPersonPricing({ pricePerNight, nights })).toBeNull();
    }
  });

  it("buildExtraPersonPricing: zero price per night is allowed (a free additional guest is a valid config)", () => {
    expect(buildExtraPersonPricing({ pricePerNight: 0, nights: 3 })?.price).toEqual({
      amount: 0,
      currency: "EUR",
    });
  });

  it("buildOccupancyAmendmentPayload: disposable-test worked example (three nights, +30 EUR each, +1 adult)", () => {
    // Mirrors the live-verified controlled test: 159 -> 189, 169 -> 199, 149 -> 179.
    const payload = buildOccupancyAmendmentPayload({
      reservation: reservation({ adults: 2, childrenAges: null }),
      timeSlices: [slice("RP1", 159), slice("RP1", 169), slice("RP1", 149)],
      extraPersonPricePerNight: 30,
      additionalPersonCount: 1,
    });
    expect(payload?.adults).toBe(3);
    expect(payload?.childrenAges).toBeNull();
    expect(payload?.requote).toBe(false);
    expect(payload?.arrival).toBe("2026-09-01");
    expect(payload?.departure).toBe("2026-09-05");
    expect(payload?.timeSlices.map((s) => s.totalGrossAmount.amount)).toEqual([189, 199, 179]);
    // ratePlanId is resent unchanged for every slice — never repriced.
    expect(payload?.timeSlices.every((s) => s.ratePlanId === "RP1")).toBe(true);
  });

  it("buildOccupancyAmendmentPayload: quantity 2 doubles the per-night surcharge (240 EUR / 4 nights example)", () => {
    const payload = buildOccupancyAmendmentPayload({
      reservation: reservation({ adults: 2 }),
      timeSlices: [slice("RP1", 100), slice("RP1", 100), slice("RP1", 100), slice("RP1", 100)],
      extraPersonPricePerNight: 30,
      additionalPersonCount: 2,
    });
    expect(payload?.adults).toBe(4);
    expect(payload?.timeSlices.map((s) => s.totalGrossAmount.amount)).toEqual([160, 160, 160, 160]);
  });

  it("buildOccupancyAmendmentPayload: preserves differing per-night rates exactly, adding the same flat surcharge to each", () => {
    const payload = buildOccupancyAmendmentPayload({
      reservation: reservation(),
      timeSlices: [slice("RP1", 85), slice("RP1", 95)],
      extraPersonPricePerNight: 30,
      additionalPersonCount: 1,
    });
    expect(payload?.timeSlices.map((s) => s.totalGrossAmount.amount)).toEqual([115, 125]);
  });

  it("buildOccupancyAmendmentPayload: resends the reservation's existing childrenAges unchanged", () => {
    const payload = buildOccupancyAmendmentPayload({
      reservation: reservation({ childrenAges: [4, 9] }),
      timeSlices: [slice("RP1", 100)],
      extraPersonPricePerNight: 30,
      additionalPersonCount: 1,
    });
    expect(payload?.childrenAges).toEqual([4, 9]);
  });

  it("buildOccupancyAmendmentPayload: rounds surcharge totals to 2 decimals", () => {
    const payload = buildOccupancyAmendmentPayload({
      reservation: reservation(),
      timeSlices: [slice("RP1", 100.005)],
      extraPersonPricePerNight: 33.333,
      additionalPersonCount: 1,
    });
    expect(payload?.timeSlices[0]?.totalGrossAmount.amount).toBe(133.34);
  });

  it("buildOccupancyAmendmentPayload: refuses (returns null) on a time slice missing ratePlan.id", () => {
    const payload = buildOccupancyAmendmentPayload({
      reservation: reservation(),
      timeSlices: [{ totalGrossAmount: { amount: 100, currency: "EUR" } }],
      extraPersonPricePerNight: 30,
      additionalPersonCount: 1,
    });
    expect(payload).toBeNull();
  });

  it("buildOccupancyAmendmentPayload: refuses on a time slice missing totalGrossAmount", () => {
    const payload = buildOccupancyAmendmentPayload({
      reservation: reservation(),
      timeSlices: [{ ratePlan: { id: "RP1" } }],
      extraPersonPricePerNight: 30,
      additionalPersonCount: 1,
    });
    expect(payload).toBeNull();
  });

  it("buildOccupancyAmendmentPayload: refuses on empty/missing timeSlices", () => {
    for (const timeSlices of [[], null]) {
      expect(
        buildOccupancyAmendmentPayload({
          reservation: reservation(),
          timeSlices,
          extraPersonPricePerNight: 30,
          additionalPersonCount: 1,
        }),
      ).toBeNull();
    }
  });

  it("buildOccupancyAmendmentPayload: refuses on a reservation missing arrival/departure", () => {
    expect(
      buildOccupancyAmendmentPayload({
        reservation: { adults: 2 },
        timeSlices: [slice("RP1", 100)],
        extraPersonPricePerNight: 30,
        additionalPersonCount: 1,
      }),
    ).toBeNull();
  });

  it("buildOccupancyAmendmentPayload: refuses zero, negative, or non-integer additionalPersonCount", () => {
    for (const additionalPersonCount of [0, -1, 1.5, NaN]) {
      const payload = buildOccupancyAmendmentPayload({
        reservation: reservation(),
        timeSlices: [slice("RP1", 100)],
        extraPersonPricePerNight: 30,
        additionalPersonCount,
      });
      expect(payload, `count ${String(additionalPersonCount)} must be refused`).toBeNull();
    }
  });

  it("buildOccupancyAmendmentPayload: refuses a negative or non-numeric extraPersonPricePerNight", () => {
    for (const extraPersonPricePerNight of [-1, "not-a-number" as unknown as number]) {
      expect(
        buildOccupancyAmendmentPayload({
          reservation: reservation(),
          timeSlices: [slice("RP1", 100)],
          extraPersonPricePerNight,
          additionalPersonCount: 1,
        }),
      ).toBeNull();
    }
  });
});

/* ── unit-group-restriction.test.mjs ─────────────────────────────────────────────────── */

describe("unit-group-restriction.test.mjs", () => {
  it("isUnitGroupAllowed: no restriction configured (undefined) allows every unit group", () => {
    expect(isUnitGroupAllowed(undefined, "LAEKE-AP_L")).toBe(true);
    expect(isUnitGroupAllowed(undefined, null)).toBe(true);
  });

  it("isUnitGroupAllowed: no restriction configured (empty array) allows every unit group", () => {
    expect(isUnitGroupAllowed([], "LAEKE-AP_L")).toBe(true);
  });

  it("isUnitGroupAllowed: the reservation's unit group is in the allowed list", () => {
    expect(isUnitGroupAllowed(["LAEKE-L-GARDEN", "LAEKE-XL-GARDEN"], "LAEKE-L-GARDEN")).toBe(true);
  });

  it("isUnitGroupAllowed: the reservation's unit group is NOT in the allowed list", () => {
    expect(isUnitGroupAllowed(["LAEKE-L-GARDEN", "LAEKE-XL-GARDEN"], "LAEKE-AP_L")).toBe(false);
  });

  it("isUnitGroupAllowed: missing unit-group data on the reservation fails closed when restricted", () => {
    expect(isUnitGroupAllowed(["LAEKE-L-GARDEN"], null)).toBe(false);
    expect(isUnitGroupAllowed(["LAEKE-L-GARDEN"], undefined)).toBe(false);
  });

  it("isUnitGroupAllowed: missing unit-group data never matters when the item is unrestricted", () => {
    expect(isUnitGroupAllowed([], null)).toBe(true);
    expect(isUnitGroupAllowed(undefined, undefined)).toBe(true);
  });

  it("getReservationUnitGroupId: reads the embedded unitGroup.id (verified live Apaleo shape)", () => {
    const reservation = {
      unitGroup: { id: "LAEKE-AP_L", code: "AP_L" },
      unit: { unitGroupId: "LAEKE-AP_L" },
    };
    expect(getReservationUnitGroupId(reservation)).toBe("LAEKE-AP_L");
  });

  it("getReservationUnitGroupId: falls back to unit.unitGroupId when unitGroup is absent", () => {
    expect(
      getReservationUnitGroupId({ unit: { id: "LAEKE-NEE", unitGroupId: "LAEKE-AP_L" } }),
    ).toBe("LAEKE-AP_L");
  });

  it("getReservationUnitGroupId: returns null when neither field is present", () => {
    expect(getReservationUnitGroupId({})).toBeNull();
    expect(getReservationUnitGroupId(null)).toBeNull();
    expect(getReservationUnitGroupId(undefined)).toBeNull();
  });

  it("end-to-end: a restricted reservation with no unit-group data is blocked, same as an explicitly wrong type", () => {
    const allowedUnitGroupIds = ["LAEKE-L-GARDEN", "LAEKE-XL-GARDEN"];
    const cases: [object, boolean][] = [
      [{}, false],
      [{ unitGroup: { id: "LAEKE-AP_L" } }, false],
      [{ unitGroup: { id: "LAEKE-L-GARDEN" } }, true],
    ];
    for (const [reservation, allowed] of cases) {
      expect(isUnitGroupAllowed(allowedUnitGroupIds, getReservationUnitGroupId(reservation))).toBe(
        allowed,
      );
    }
  });
});

/* ── dog-booking.test.mjs ────────────────────────────────────────────────────────────── */

describe("dog-booking.test.mjs", () => {
  it("countBookedServiceQuantity: the service isn't booked at all -> 0", () => {
    expect(countBookedServiceQuantity([], "HUESLE-HUND")).toBe(0);
    expect(
      countBookedServiceQuantity(
        [{ service: { id: "HUESLE-PARKPLATZ" }, dates: [{ count: 1 }] }],
        "HUESLE-HUND",
      ),
    ).toBe(0);
    expect(countBookedServiceQuantity(null, "HUESLE-HUND")).toBe(0);
    expect(countBookedServiceQuantity(undefined, "HUESLE-HUND")).toBe(0);
  });

  it("countBookedServiceQuantity: booked with a single date -> that date's count", () => {
    const services = [
      { service: { id: "HUESLE-HUND" }, dates: [{ serviceDate: "2026-10-10", count: 1 }] },
    ];
    expect(countBookedServiceQuantity(services, "HUESLE-HUND")).toBe(1);
  });

  it("countBookedServiceQuantity: CRITICAL — a dog booked for 6 nights (6 date entries, count 1 each) still counts as 1, never 6", () => {
    const dates = Array.from({ length: 6 }, (_, i) => ({
      serviceDate: `2026-10-${String(10 + i)}`,
      count: 1,
      amount: { grossAmount: 15, currency: "EUR" },
    }));
    const services = [{ service: { id: "HUESLE-HUND" }, dates }];
    expect(countBookedServiceQuantity(services, "HUESLE-HUND")).toBe(1);
    expect(hasReachedDogLimit(services, "HUESLE-HUND")).toBe(true);
  });

  it("countBookedServiceQuantity: reads count off a date entry, not dates.length, even for a hypothetical count > 1", () => {
    const dates = Array.from({ length: 3 }, () => ({ serviceDate: "2026-10-10", count: 2 }));
    expect(
      countBookedServiceQuantity([{ service: { id: "HUESLE-HUND" }, dates }], "HUESLE-HUND"),
    ).toBe(2);
  });

  it("countBookedServiceQuantity: a service entry with an empty dates array -> 0", () => {
    expect(
      countBookedServiceQuantity([{ service: { id: "HUESLE-HUND" }, dates: [] }], "HUESLE-HUND"),
    ).toBe(0);
  });

  it("countBookedServiceQuantity: malformed/missing dates never throws, resolves to 0", () => {
    expect(() =>
      countBookedServiceQuantity([{ service: { id: "HUESLE-HUND" } }], "HUESLE-HUND"),
    ).not.toThrow();
    expect(countBookedServiceQuantity([{ service: { id: "HUESLE-HUND" } }], "HUESLE-HUND")).toBe(0);
    expect(
      countBookedServiceQuantity([{ service: { id: "HUESLE-HUND" }, dates: [{}] }], "HUESLE-HUND"),
    ).toBe(0);
  });

  it("hasReachedDogLimit: false when not booked, true once booked (>= MAX_DOGS_PER_RESERVATION)", () => {
    expect(MAX_DOGS_PER_RESERVATION).toBe(1);
    expect(hasReachedDogLimit([], "HUESLE-HUND")).toBe(false);
    expect(
      hasReachedDogLimit(
        [{ service: { id: "HUESLE-HUND" }, dates: [{ count: 1 }] }],
        "HUESLE-HUND",
      ),
    ).toBe(true);
  });

  it("countBookedServiceQuantity / hasReachedDogLimit: works for any property's own service id, not hardcoded to one", () => {
    const services = [{ service: { id: "ALTUS-HUND" }, dates: [{ count: 1 }] }];
    expect(countBookedServiceQuantity(services, "ALTUS-HUND")).toBe(1);
    expect(hasReachedDogLimit(services, "ALTUS-HUND")).toBe(true);
    expect(hasReachedDogLimit(services, "HUESLE-HUND")).toBe(false);
  });

  it("other extras (a different, non-dog service on the same reservation) are completely unaffected", () => {
    const services = [
      { service: { id: "HUESLE-HUND" }, dates: [{ count: 1 }] },
      { service: { id: "HUESLE-PARKPLATZ" }, dates: [{ count: 3 }] },
    ];
    expect(countBookedServiceQuantity(services, "HUESLE-PARKPLATZ")).toBe(3);
    // Parkplatz itself has no max-1 rule; this just proves the counter reads the right entry.
    expect(hasReachedDogLimit(services, "HUESLE-PARKPLATZ")).toBe(true);
    expect(countBookedServiceQuantity(services, "HUESLE-HUND")).toBe(1);
  });
});

/* ── vehicle-registration.test.mjs (resizeVehiclePlates is a UI helper – not ported) ──── */

describe("vehicle-registration.test.mjs", () => {
  it("hasCompleteVehiclePlates: parking quantity 0 -> no plate required", () => {
    expect(hasCompleteVehiclePlates([], 0)).toBe(true);
    expect(hasCompleteVehiclePlates(undefined, 0)).toBe(true);
  });

  it("hasCompleteVehiclePlates: parking quantity 1 -> one plate required", () => {
    expect(hasCompleteVehiclePlates([""], 1)).toBe(false);
    expect(hasCompleteVehiclePlates(["LI-UP 123"], 1)).toBe(true);
  });

  it("hasCompleteVehiclePlates: parking quantity 2 -> two plates required", () => {
    expect(hasCompleteVehiclePlates(["LI-UP 123", ""], 2)).toBe(false);
    expect(hasCompleteVehiclePlates(["LI-UP 123", "B-AB 456"], 2)).toBe(true);
  });

  it("hasCompleteVehiclePlates: whitespace-only counts as empty", () => {
    expect(hasCompleteVehiclePlates(["   "], 1)).toBe(false);
  });

  it("hasCompleteVehiclePlates: entries beyond the required count never matter", () => {
    expect(hasCompleteVehiclePlates(["LI-UP 123", "", "ignored"], 1)).toBe(true);
  });

  it("normalizeVehiclePlates: empty plate blocks booking (returns null)", () => {
    expect(normalizeVehiclePlates(["LI-UP 123", ""], 2)).toBeNull();
    expect(normalizeVehiclePlates([], 1)).toBeNull();
  });

  it("normalizeVehiclePlates: a complete list is trimmed and truncated to exactly `count`", () => {
    expect(normalizeVehiclePlates(["  LI-UP 123  ", " B-AB 456 ", "extra"], 2)).toEqual([
      "LI-UP 123",
      "B-AB 456",
    ]);
  });

  it("normalizeVehiclePlates: quantity 0 normalizes to an empty (valid) list", () => {
    expect(normalizeVehiclePlates([], 0)).toEqual([]);
  });

  it("buildPrimaryVehicleRegistration: primary vehicle registration is built for Apaleo with the default country code", () => {
    expect(buildPrimaryVehicleRegistration(["LI-UP 123"])).toEqual({
      number: "LI-UP 123",
      countryCode: DEFAULT_VEHICLE_COUNTRY_CODE,
    });
    expect(DEFAULT_VEHICLE_COUNTRY_CODE).toBe("DE");
  });

  it("buildPrimaryVehicleRegistration: only the first plate is ever used for the primary field", () => {
    expect(buildPrimaryVehicleRegistration(["LI-UP 123", "B-AB 456"])).toEqual({
      number: "LI-UP 123",
      countryCode: "DE",
    });
  });

  it("buildPrimaryVehicleRegistration: a custom country code is honored", () => {
    expect(buildPrimaryVehicleRegistration(["AB-123", "AT"], "AT")).toEqual({
      number: "AB-123",
      countryCode: "AT",
    });
  });

  it("buildPrimaryVehicleRegistration: no plates -> null, never fabricates a value", () => {
    expect(buildPrimaryVehicleRegistration([])).toBeNull();
    expect(buildPrimaryVehicleRegistration(undefined)).toBeNull();
  });

  it("formatVehiclePlatesComment: additional vehicles are formatted exactly per the required structure", () => {
    expect(formatVehiclePlatesComment(["LI-UP 123", "B-AB 456"])).toBe(
      "Parking vehicles:\n1. LI-UP 123\n2. B-AB 456",
    );
  });

  it("formatVehiclePlatesComment: three or more vehicles are handled safely", () => {
    expect(formatVehiclePlatesComment(["A-AA 1", "B-BB 2", "C-CC 3"])).toBe(
      "Parking vehicles:\n1. A-AA 1\n2. B-BB 2\n3. C-CC 3",
    );
  });

  it("formatVehiclePlatesComment: a single plate never produces a comment (already covered by the primary field)", () => {
    expect(formatVehiclePlatesComment(["LI-UP 123"])).toBeNull();
    expect(formatVehiclePlatesComment([])).toBeNull();
    expect(formatVehiclePlatesComment(undefined)).toBeNull();
  });
});

/* ── price-display.test.mjs ──────────────────────────────────────────────────────────── */

describe("price-display.test.mjs", () => {
  it("resolvePriceUnitLabel: custom label wins over the bookingRule default", () => {
    expect(resolvePriceUnitLabel("per_night", "pro Stellplatz / Nacht")).toBe(
      "pro Stellplatz / Nacht",
    );
    expect(resolvePriceUnitLabel("per_stay", "pro Person")).toBe("pro Person");
  });

  it("resolvePriceUnitLabel: trims whitespace-only custom labels down to the default", () => {
    expect(resolvePriceUnitLabel("per_night", "   ")).toBe(DEFAULT_PRICE_UNIT_LABELS.de.per_night);
    expect(resolvePriceUnitLabel("per_night", "  pro Nacht  ")).toBe("pro Nacht");
  });

  it("resolvePriceUnitLabel: fallback labels per bookingRule when unset", () => {
    expect(resolvePriceUnitLabel("per_night", undefined)).toBe("pro Nacht");
    expect(resolvePriceUnitLabel("per_stay", "")).toBe("pro Aufenthalt");
    expect(resolvePriceUnitLabel("arrival_day", null)).toBe("einmalig");
    expect(resolvePriceUnitLabel("departure_day", "")).toBe("einmalig");
  });

  it("resolvePriceUnitLabel: unknown bookingRule falls back to empty string, never throws", () => {
    expect(resolvePriceUnitLabel("something_unexpected", "")).toBe("");
  });

  it("resolvePriceUnitLabel: defaults to German when no language argument is given (backward compatible)", () => {
    expect(resolvePriceUnitLabel("per_night", "")).toBe(DEFAULT_PRICE_UNIT_LABELS.de.per_night);
  });

  it("resolvePriceUnitLabel: English defaults per bookingRule when unset", () => {
    expect(resolvePriceUnitLabel("per_night", undefined, "en")).toBe("per night");
    expect(resolvePriceUnitLabel("per_stay", "", "en")).toBe("per stay");
    expect(resolvePriceUnitLabel("arrival_day", null, "en")).toBe("one-time");
    expect(resolvePriceUnitLabel("departure_day", "", "en")).toBe("one-time");
    expect(DEFAULT_PRICE_UNIT_LABELS.en).toEqual({
      per_night: "per night",
      per_stay: "per stay",
      arrival_day: "one-time",
      departure_day: "one-time",
      per_person_per_night: "per person / night",
    });
  });

  it("resolvePriceUnitLabel: per_person_per_night default (actionType increase_occupancy, e.g. 'Extra person')", () => {
    expect(resolvePriceUnitLabel("per_person_per_night", undefined)).toBe("pro Person / Nacht");
    expect(resolvePriceUnitLabel("per_person_per_night", undefined, "en")).toBe(
      "per person / night",
    );
  });

  it("resolvePriceUnitLabel: a custom label wins regardless of requested language", () => {
    expect(resolvePriceUnitLabel("per_night", "pro Stellplatz / Nacht", "en")).toBe(
      "pro Stellplatz / Nacht",
    );
  });

  it("computePriceBreakdown: quantity 0 shows nothing (no total before selection)", () => {
    expect(
      computePriceBreakdown({
        unitPrice: { amount: 15, currency: "EUR" },
        nights: 7,
        price: { amount: 105, currency: "EUR" },
        count: 0,
      }),
    ).toBeNull();
  });

  it("computePriceBreakdown: single-night, single-unit item shows nothing (unit price already is the total)", () => {
    expect(
      computePriceBreakdown({
        unitPrice: { amount: 20, currency: "EUR" },
        nights: 1,
        price: { amount: 20, currency: "EUR" },
        count: 1,
      }),
    ).toBeNull();
  });

  it("computePriceBreakdown: per-night item, quantity 1, 7-night stay -> unit x nights = total, no count segment", () => {
    expect(
      computePriceBreakdown({
        unitPrice: { amount: 15, currency: "EUR" },
        nights: 7,
        price: { amount: 105, currency: "EUR" }, // server-computed unit x nights
        count: 1,
      }),
    ).toEqual({
      unitPrice: { amount: 15, currency: "EUR" },
      nights: 7,
      count: null,
      total: { amount: 105, currency: "EUR" },
    });
  });

  it("computePriceBreakdown: per-night item, quantity 2, 7-night stay -> unit x nights x count = total", () => {
    expect(
      computePriceBreakdown({
        unitPrice: { amount: 15, currency: "EUR" },
        nights: 7,
        price: { amount: 105, currency: "EUR" },
        count: 2,
      }),
    ).toEqual({
      unitPrice: { amount: 15, currency: "EUR" },
      nights: 7,
      count: 2,
      total: { amount: 210, currency: "EUR" }, // 15 x 7 x 2 = 210
    });
  });

  it("computePriceBreakdown: single-night item, quantity 2 -> unit x count = total, no nights segment", () => {
    expect(
      computePriceBreakdown({
        unitPrice: { amount: 20, currency: "EUR" },
        nights: 1,
        price: { amount: 20, currency: "EUR" },
        count: 2,
      }),
    ).toEqual({
      unitPrice: { amount: 20, currency: "EUR" },
      nights: null,
      count: 2,
      total: { amount: 40, currency: "EUR" },
    });
  });

  it("computePriceBreakdown: rounds to 2 decimals", () => {
    const result = computePriceBreakdown({
      unitPrice: { amount: 12.1, currency: "EUR" },
      nights: 3,
      price: { amount: 36.3, currency: "EUR" },
      count: 3,
    });
    expect(result?.total.amount).toBe(108.9);
  });

  it("computePriceBreakdown: null price (e.g. Apaleo returned no price) yields no breakdown", () => {
    expect(computePriceBreakdown({ unitPrice: null, nights: 4, price: null, count: 2 })).toBeNull();
  });
});

/* ── catalog-localization.test.mjs ───────────────────────────────────────────────────── */

describe("catalog-localization.test.mjs", () => {
  it("German Apaleo value is shown when available (the Car park / Parkplatz case)", () => {
    const result = resolveBilingualText({
      overrideDe: undefined,
      overrideEn: undefined,
      apaleoDe: "Parkplatz",
      apaleoEn: "Car park",
      genericFallback: "Car park", // the stale, never-translated catalog field that caused the bug
      finalFallback: "LAEKE-PKW",
    });
    expect(result).toEqual({ de: "Parkplatz", en: "Car park" });
  });

  it("English Apaleo value is shown when available", () => {
    const result = resolveBilingualText({
      apaleoDe: "Frühstück",
      apaleoEn: "Breakfast",
      genericFallback: "",
      finalFallback: "",
    });
    expect(result).toEqual({ de: "Frühstück", en: "Breakfast" });
  });

  it("a curated per-language override wins over Apaleo's own localized value", () => {
    const result = resolveBilingualText({
      overrideDe: "Unser Parkplatz",
      overrideEn: undefined,
      apaleoDe: "Parkplatz",
      apaleoEn: "Car park",
      genericFallback: "",
      finalFallback: "",
    });
    expect(result.de, "the DE override must win over the Apaleo DE value").toBe("Unser Parkplatz");
    expect(result.en, "no EN override was set, so Apaleo's EN value still applies").toBe(
      "Car park",
    );
  });

  it("fallback logic: missing translation in the requested language falls back to the other Apaleo language", () => {
    const result = resolveBilingualText({
      apaleoDe: undefined, // Apaleo has no German string for this service at all
      apaleoEn: "Late check-out",
      genericFallback: "",
      finalFallback: "",
    });
    expect(result.de, "falls back to the English Apaleo value rather than showing nothing").toBe(
      "Late check-out",
    );
    expect(result.en).toBe("Late check-out");
  });

  it("fallback logic: no Apaleo data at all falls back to the existing generic catalog field", () => {
    const result = resolveBilingualText({
      apaleoDe: undefined,
      apaleoEn: undefined,
      genericFallback: "Frühstücksbuffet",
      finalFallback: "BREAKFAST",
    });
    expect(result).toEqual({ de: "Frühstücksbuffet", en: "Frühstücksbuffet" });
  });

  it("existing catalog entries without any localized fields still work (nothing at all -> final fallback)", () => {
    const result = resolveBilingualText({
      overrideDe: undefined,
      overrideEn: undefined,
      apaleoDe: undefined,
      apaleoEn: undefined,
      genericFallback: undefined,
      finalFallback: "LAEKE-PKW",
    });
    expect(result).toEqual({ de: "LAEKE-PKW", en: "LAEKE-PKW" });
  });

  it("description has no final-fallback requirement — empty stays empty when nothing is available", () => {
    const result = resolveBilingualText({
      apaleoDe: undefined,
      apaleoEn: undefined,
      genericFallback: "",
      finalFallback: "",
    });
    expect(result).toEqual({ de: "", en: "" });
  });

  it("whitespace-only overrides/values are treated as absent, not used verbatim", () => {
    const result = resolveBilingualText({
      overrideDe: "   ",
      apaleoDe: "Parkplatz",
      apaleoEn: "Car park",
      genericFallback: "",
      finalFallback: "",
    });
    expect(result.de, "a whitespace-only override must not win over a real Apaleo value").toBe(
      "Parkplatz",
    );
  });

  // STAY: resolveBilingualPriceUnitLabel uses the built-in resolvePriceUnitLabel (no injection).
  it("price unit labels: a per-language override wins", () => {
    const result = resolveBilingualPriceUnitLabel({
      overrideDe: "pro Stellplatz / Nacht",
      overrideEn: "per parking space / night",
      genericPriceUnitLabel: "",
      bookingRule: "per_night",
    });
    expect(result).toEqual({ de: "pro Stellplatz / Nacht", en: "per parking space / night" });
  });

  it("price unit labels: falls back to the existing generic priceUnitLabel field for both languages", () => {
    const result = resolveBilingualPriceUnitLabel({
      overrideDe: undefined,
      overrideEn: undefined,
      genericPriceUnitLabel: "pro Stellplatz / Nacht",
      bookingRule: "per_night",
    });
    expect(result.de).toBe("pro Stellplatz / Nacht");
    expect(result.en, "the generic field is used verbatim regardless of language").toBe(
      "pro Stellplatz / Nacht",
    );
  });

  it("price unit labels: falls back to the bookingRule-based translated default per language", () => {
    const result = resolveBilingualPriceUnitLabel({
      overrideDe: undefined,
      overrideEn: undefined,
      genericPriceUnitLabel: "",
      bookingRule: "per_night",
    });
    expect(result).toEqual({ de: "pro Nacht", en: "per night" });
  });

  it("price unit labels switch correctly across bookingRules and languages", () => {
    const cases: [string, string, string][] = [
      ["per_stay", "pro Aufenthalt", "per stay"],
      ["arrival_day", "einmalig", "one-time"],
      ["departure_day", "einmalig", "one-time"],
    ];
    for (const [bookingRule, de, en] of cases) {
      const result = resolveBilingualPriceUnitLabel({ genericPriceUnitLabel: "", bookingRule });
      expect(result.de, `de default for ${bookingRule}`).toBe(de);
      expect(result.en, `en default for ${bookingRule}`).toBe(en);
    }
  });
});

/* ── catalog-sort.test.mjs ───────────────────────────────────────────────────────────── */

describe("catalog-sort.test.mjs", () => {
  type SortItem = { name: string; sortOrder?: number | null };
  function byName(items: SortItem[]): string[] {
    return [...items].sort(compareBySortOrder).map((i) => i.name);
  }

  it("sorts ascending by sortOrder", () => {
    const items = [
      { name: "Late Check-out", sortOrder: 40 },
      { name: "Car park", sortOrder: 10 },
      { name: "Dog", sortOrder: 20 },
      { name: "Early Check-in", sortOrder: 30 },
      { name: "Baby cot", sortOrder: 50 },
    ];
    expect(byName(items)).toEqual([
      "Car park",
      "Dog",
      "Early Check-in",
      "Late Check-out",
      "Baby cot",
    ]);
  });

  it("items without sortOrder appear after every item that has one", () => {
    const items = [
      { name: "No order A" },
      { name: "Car park", sortOrder: 10 },
      { name: "No order B" },
      { name: "Dog", sortOrder: 20 },
    ];
    expect(byName(items)).toEqual(["Car park", "Dog", "No order A", "No order B"]);
  });

  it("items without sortOrder preserve their original relative order (stable fallback)", () => {
    expect(byName([{ name: "First" }, { name: "Second" }, { name: "Third" }])).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("a null or non-numeric sortOrder is treated the same as missing", () => {
    const items: SortItem[] = [
      { name: "Null order", sortOrder: null },
      { name: "Car park", sortOrder: 10 },
      { name: "String order", sortOrder: "not-a-number" as unknown as number },
    ];
    expect(byName(items)).toEqual(["Car park", "Null order", "String order"]);
  });

  it("ties on an explicit sortOrder preserve original relative order", () => {
    const items = [
      { name: "First at 10", sortOrder: 10 },
      { name: "Second at 10", sortOrder: 10 },
    ];
    expect(byName(items)).toEqual(["First at 10", "Second at 10"]);
  });
});

/* ── request-approval.test.mjs (only the pure-rules test; the rest drive approveRequest) ── */

describe("request-approval.test.mjs", () => {
  it("pure rules: existing booking comparison and per-date availability", () => {
    const services: ApaleoBookedService[] = [
      {
        service: { id: "S" },
        dates: [
          { serviceDate: "2030-01-01", count: 2 },
          { serviceDate: "2030-01-02", count: 2 },
        ],
      },
    ];
    expect(compareExistingBooking(services, "X", ["2030-01-01"], 1)).toBe("none");
    expect(compareExistingBooking(services, "S", ["2030-01-01", "2030-01-02"], 2)).toBe("complete");
    expect(compareExistingBooking(services, "S", ["2030-01-01", "2030-01-02"], 3)).toBe("conflict");
    expect(compareExistingBooking(services, "S", ["2030-01-01", "2030-01-03"], 1)).toBe("conflict");
    const offer: ApaleoServiceOffer = {
      dates: [
        { serviceDate: "a", availableCount: 3 },
        { serviceDate: "b", availableCount: 1 },
        { serviceDate: "c" },
      ],
    };
    expect(datesWithoutAvailability(offer, ["a", "b", "c"], 2)).toEqual(["b"]);
  });
});

/* ── STAY-only: the documented deviation from Extras ─────────────────────────────────── */

describe("STAY deviations from Extras", () => {
  it('buildExtraPersonPricing: a missing price (null/undefined/"") is refused, not treated as free like Number(null) in Extras', () => {
    for (const pricePerNight of [null, undefined, ""]) {
      expect(buildExtraPersonPricing({ pricePerNight, nights: 3 })).toBeNull();
    }
    expect(buildExtraPersonPricing({ pricePerNight: 0, nights: 3 })?.price.amount).toBe(0);
  });
});

describe("M4: additional guest price", () => {
  it("0 € per night is a valid, explicitly free price; empty or missing is not", () => {
    expect(buildExtraPersonPricing({ pricePerNight: 0, nights: 2 })?.price).toEqual({
      amount: 0,
      currency: "EUR",
    });
    expect(buildExtraPersonPricing({ pricePerNight: "", nights: 2 })).toBeNull();
    expect(buildExtraPersonPricing({ pricePerNight: null, nights: 2 })).toBeNull();
    expect(buildExtraPersonPricing({ pricePerNight: undefined, nights: 2 })).toBeNull();
  });
});
