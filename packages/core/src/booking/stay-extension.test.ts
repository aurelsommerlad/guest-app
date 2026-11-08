/**
 * 1:1 port of the Extras reference tests for the "Eine Nacht länger" rules (stay-extension.ts):
 * the pure part of test/stay-extension.test.mjs and the read-side of
 * test/extension-config.test.mjs (Extras getExtensionConfig → resolveStayExtensionSettings).
 * The Extras integration tests (getStayExtensionOffer, confirmStayExtension,
 * determineConsecutiveFreeNights, saveExtensionConfig) do I/O and are not ported.
 */
import { describe, expect, it } from "vitest";

import type { ApaleoBookedService, TimeSliceLike } from "./service-rules";
import {
  addOneDay,
  buildExtensionOffer,
  buildExtensionPricePreview,
  buildLateCheckoutMoveDates,
  buildServiceExtensionDates,
  buildStayExtensionAmendmentPayload,
  computeAverageNightlyRate,
  computeExtensionAdditionalTotal,
  decideExtensionOffer,
  determineStayExtensionPhase,
  findCityTaxAmount,
  findDepartureDateCandidates,
  findExtendableServices,
  resolveStayExtensionSettings,
  verifyLateCheckoutMove,
} from "./stay-extension";

/* ── extension-config.test.mjs ───────────────────────────────────────────────────────── */

describe("extension-config.test.mjs", () => {
  it("getExtensionConfig: a property with nothing stored at all gets the documented example defaults for both phases", () => {
    for (const stored of [null, undefined, {}]) {
      expect(resolveStayExtensionSettings(stored)).toEqual({
        extensionNightEnabled: false,
        extensionDiscountPreArrivalOneNightGap: 15,
        extensionDiscountPreArrivalStandard: 10,
        extensionDiscountInHouseOneNightGap: 20,
        extensionDiscountInHouseStandard: 15,
        minSellableStayNights: 2,
      });
    }
  });

  it("getExtensionConfig: old stored config (only the flat legacy fields, no phase-specific fields yet) still works via fallback for BOTH phases", () => {
    // Exactly the shape a pre-migration production property already has stored.
    const config = resolveStayExtensionSettings({
      extensionNightEnabled: true,
      extensionDiscountOneNightGap: 25,
      extensionDiscountStandard: 12,
      minSellableStayNights: 3,
    });
    expect(config.extensionNightEnabled).toBe(true);
    expect(config.minSellableStayNights).toBe(3);
    // Both phases fall back to the same legacy numbers until the new fields are saved.
    expect(config.extensionDiscountPreArrivalOneNightGap).toBe(25);
    expect(config.extensionDiscountPreArrivalStandard).toBe(12);
    expect(config.extensionDiscountInHouseOneNightGap).toBe(25);
    expect(config.extensionDiscountInHouseStandard).toBe(12);
  });

  it("getExtensionConfig: once the phase-specific fields are explicitly saved, they take priority over the legacy fields", () => {
    const config = resolveStayExtensionSettings({
      extensionNightEnabled: true,
      extensionDiscountOneNightGap: 25,
      extensionDiscountStandard: 12,
      extensionDiscountPreArrivalOneNightGap: 15,
      extensionDiscountPreArrivalStandard: 10,
      extensionDiscountInHouseOneNightGap: 20,
      extensionDiscountInHouseStandard: 15,
      minSellableStayNights: 2,
    });
    // New fields win, NOT the legacy 25/12 that's still sitting there.
    expect(config.extensionDiscountPreArrivalOneNightGap).toBe(15);
    expect(config.extensionDiscountPreArrivalStandard).toBe(10);
    expect(config.extensionDiscountInHouseOneNightGap).toBe(20);
    expect(config.extensionDiscountInHouseStandard).toBe(15);
  });

  it("getExtensionConfig: a partially-migrated property (only pre-arrival explicitly saved) falls back to legacy for in-house only", () => {
    const config = resolveStayExtensionSettings({
      extensionNightEnabled: true,
      extensionDiscountOneNightGap: 25,
      extensionDiscountStandard: 12,
      extensionDiscountPreArrivalOneNightGap: 15,
      extensionDiscountPreArrivalStandard: 10,
      minSellableStayNights: 2,
    });
    expect(config.extensionDiscountPreArrivalOneNightGap).toBe(15);
    expect(config.extensionDiscountPreArrivalStandard).toBe(10);
    // In-house fields were never explicitly saved -> still the legacy values.
    expect(config.extensionDiscountInHouseOneNightGap).toBe(25);
    expect(config.extensionDiscountInHouseStandard).toBe(12);
  });
});

/* ── stay-extension.test.mjs (section 1 / 1b: pure unit tests) ───────────────────────── */

// The Extras suite mocks Date to this instant for every test (mock.timers); the STAY API takes
// `today` explicitly instead.
const TODAY = new Date("2026-09-09T10:00:00Z");

const CONFIG = {
  // Not part of the Extras fixture; required by StayExtensionSettings, never read by the rules.
  extensionNightEnabled: true,
  minSellableStayNights: 2,
  extensionDiscountOneNightGap: 20,
  extensionDiscountStandard: 15,
  // buildExtensionOffer reads only the phase-specific fields — both phases set to the same
  // numbers so the generic tests get the identical discountPercent regardless of phase.
  extensionDiscountPreArrivalOneNightGap: 20,
  extensionDiscountPreArrivalStandard: 15,
  extensionDiscountInHouseOneNightGap: 20,
  extensionDiscountInHouseStandard: 15,
};

// Distinct pre-arrival vs in-house values make the phase-dependent selection observable.
const PHASE_CONFIG = {
  extensionNightEnabled: true,
  minSellableStayNights: 2,
  extensionDiscountPreArrivalOneNightGap: 15,
  extensionDiscountPreArrivalStandard: 10,
  extensionDiscountInHouseOneNightGap: 20,
  extensionDiscountInHouseStandard: 15,
};

function configArgs(config: {
  minSellableStayNights: number;
  extensionDiscountOneNightGap: number;
  extensionDiscountStandard: number;
}) {
  return {
    minSellableStayNights: config.minSellableStayNights,
    discountOneNightGap: config.extensionDiscountOneNightGap,
    discountStandard: config.extensionDiscountStandard,
  };
}

function slice(ratePlanId: string, amount: number, currency = "EUR"): TimeSliceLike {
  return { ratePlan: { id: ratePlanId }, totalGrossAmount: { amount, currency } };
}

function serviceEntry(
  id: string,
  dates: [string, number, number?][],
  { name = id, mandatory = false }: { name?: string; mandatory?: boolean } = {},
): ApaleoBookedService {
  return {
    service: { id, code: id, name },
    dates: dates.map(([serviceDate, amount, count = 1]) => ({
      serviceDate,
      count,
      amount: { grossAmount: amount, currency: "EUR" },
      isMandatory: mandatory,
    })),
  };
}

const DEPARTURE = "2026-10-16T10:00:00+02:00";

describe("stay-extension.test.mjs", () => {
  it("decideExtensionOffer: gap 0 -> no offer", () => {
    expect(decideExtensionOffer({ gap: 0, ...configArgs(CONFIG) }).offer).toBe(false);
  });

  it("decideExtensionOffer: gap 1 -> offer at the one-night-gap discount (closes the gap)", () => {
    expect(decideExtensionOffer({ gap: 1, ...configArgs(CONFIG) })).toEqual({
      offer: true,
      discountPercent: 20,
      reason: "closes_gap",
    });
  });

  it("decideExtensionOffer: gap 2 -> no offer (would leave a new isolated 1-night gap)", () => {
    expect(decideExtensionOffer({ gap: 2, ...configArgs(CONFIG) })).toEqual({
      offer: false,
      reason: "would_leave_unsellable_gap",
    });
  });

  it("decideExtensionOffer: gap 3 (remaining == minSellableStayNights, still 'at least' sellable) -> offer at the standard discount", () => {
    expect(decideExtensionOffer({ gap: 3, ...configArgs(CONFIG) })).toMatchObject({
      offer: true,
      discountPercent: 15,
    });
  });

  it("decideExtensionOffer: gap 4 (> minSellableStayNights) -> offer at the standard discount", () => {
    expect(decideExtensionOffer({ gap: 4, ...configArgs(CONFIG) })).toEqual({
      offer: true,
      discountPercent: 15,
      reason: "remaining_gap_sellable",
    });
  });

  it("decideExtensionOffer: longer gaps (10, 100) still offer exactly the standard discount", () => {
    for (const gap of [10, 100]) {
      expect(decideExtensionOffer({ gap, ...configArgs(CONFIG) })).toMatchObject({
        offer: true,
        discountPercent: 15,
      });
    }
  });

  it("decideExtensionOffer: the no-offer zone widens correctly when minSellableStayNights changes", () => {
    const config = { ...CONFIG, minSellableStayNights: 3 };
    const cases: [number, boolean][] = [
      [1, true], // still closes the gap
      [2, false],
      [3, false],
      [4, true], // remaining == 3, "at least" 3 is sellable
      [5, true],
    ];
    for (const [gap, offer] of cases) {
      expect(decideExtensionOffer({ gap, ...configArgs(config) }).offer, `gap ${String(gap)}`).toBe(
        offer,
      );
    }
  });

  it("computeAverageNightlyRate: task's worked example (uniform 160 EUR/night)", () => {
    expect(
      computeAverageNightlyRate([slice("RP1", 160), slice("RP1", 160), slice("RP1", 160)]),
    ).toBe(160);
  });

  it("computeAverageNightlyRate: varying nightly prices average correctly", () => {
    expect(
      computeAverageNightlyRate([slice("RP1", 140), slice("RP1", 160), slice("RP1", 180)]),
    ).toBe(160);
  });

  it("computeAverageNightlyRate: rounds to EUR cents", () => {
    expect(
      computeAverageNightlyRate([slice("RP1", 100), slice("RP1", 100), slice("RP1", 100.01)]),
    ).toBe(100);
  });

  it("computeAverageNightlyRate: refuses (null) on empty/missing timeSlices", () => {
    expect(computeAverageNightlyRate([])).toBeNull();
    expect(computeAverageNightlyRate(null)).toBeNull();
  });

  it("computeAverageNightlyRate: refuses on a slice missing totalGrossAmount", () => {
    expect(computeAverageNightlyRate([{ ratePlan: { id: "RP1" } }])).toBeNull();
  });

  it("addOneDay: plain date and full ISO timestamp both shift by exactly one calendar day", () => {
    expect(addOneDay("2026-10-16")).toBe("2026-10-17");
    expect(addOneDay("2026-10-16T10:00:00+02:00")).toBe("2026-10-17");
  });

  it("addOneDay: handles a month/year boundary", () => {
    expect(addOneDay("2026-12-31")).toBe("2027-01-01");
  });

  it("buildExtensionOffer: task's worked example end to end (160 EUR average, 1-night gap -> 20% off -> 128.00)", () => {
    const timeSlices = [slice("RP1", 160), slice("RP1", 160), slice("RP1", 160), slice("RP1", 160)];
    const offer = buildExtensionOffer({
      reservation: { departure: DEPARTURE },
      timeSlices,
      gap: 1,
      config: CONFIG,
      phase: "in_house",
    });
    expect(offer).not.toBeNull();
    expect(offer?.averageNightlyRate).toEqual({ amount: 160, currency: "EUR" });
    expect(offer?.extensionPrice).toEqual({ amount: 128, currency: "EUR" });
    expect(offer?.discountPercent).toBe(20);
    expect(offer?.currentDeparture).toBe("2026-10-16");
    expect(offer?.newDeparture).toBe("2026-10-17");
    expect(offer?.phase).toBe("in_house");
  });

  it("buildExtensionOffer: 4-night gap example (160 EUR average -> 15% off -> 136.00)", () => {
    const timeSlices = [slice("RP1", 160), slice("RP1", 160)];
    const offer = buildExtensionOffer({
      reservation: { departure: DEPARTURE },
      timeSlices,
      gap: 4,
      config: CONFIG,
      phase: "before_arrival",
    });
    expect(offer?.extensionPrice).toEqual({ amount: 136, currency: "EUR" });
    expect(offer?.discountPercent).toBe(15);
  });

  it("buildExtensionOffer: returns null (no offer shown at all) when the gap doesn't qualify", () => {
    const reservation = { departure: DEPARTURE };
    const timeSlices = [slice("RP1", 160)];
    expect(
      buildExtensionOffer({
        reservation,
        timeSlices,
        gap: 0,
        config: CONFIG,
        phase: "before_arrival",
      }),
    ).toBeNull();
    expect(
      buildExtensionOffer({ reservation, timeSlices, gap: 2, config: CONFIG, phase: "in_house" }),
    ).toBeNull();
  });

  // Phase-specific discount selection: only WHICH discount gets plugged into the unchanged
  // gap decision depends on the phase.
  it.each([
    [
      "buildExtensionOffer: pre-arrival, gap 1 (closes the gap) -> pre-arrival one-night-gap discount (15%)",
      "before_arrival",
      1,
      15,
    ],
    [
      "buildExtensionOffer: pre-arrival, standard gap (> minSellableStayNights) -> pre-arrival standard discount (10%)",
      "before_arrival",
      4,
      10,
    ],
    [
      "buildExtensionOffer: in_house, gap 1 (closes the gap) -> in-house one-night-gap discount (20%)",
      "in_house",
      1,
      20,
    ],
    [
      "buildExtensionOffer: in_house, standard gap (> minSellableStayNights) -> in-house standard discount (15%)",
      "in_house",
      4,
      15,
    ],
  ] as const)("%s", (_name, phase, gap, discountPercent) => {
    const timeSlices = [slice("RP1", 200), slice("RP1", 200)];
    const offer = buildExtensionOffer({
      reservation: { departure: DEPARTURE },
      timeSlices,
      gap,
      config: PHASE_CONFIG,
      phase,
    });
    expect(offer).not.toBeNull();
    expect(offer?.discountPercent).toBe(discountPercent);
    expect(offer?.phase).toBe(phase);
  });

  it("buildExtensionOffer: the same gap produces different discountPercent depending only on phase, config held constant", () => {
    const reservation = { departure: DEPARTURE };
    const timeSlices = [slice("RP1", 200), slice("RP1", 200)];
    const preArrival = buildExtensionOffer({
      reservation,
      timeSlices,
      gap: 1,
      config: PHASE_CONFIG,
      phase: "before_arrival",
    });
    const inHouse = buildExtensionOffer({
      reservation,
      timeSlices,
      gap: 1,
      config: PHASE_CONFIG,
      phase: "in_house",
    });
    expect(preArrival?.discountPercent).toBe(15);
    expect(inHouse?.discountPercent).toBe(20);
    expect(preArrival?.discountPercent).not.toBe(inHouse?.discountPercent);
  });

  it("buildStayExtensionAmendmentPayload: existing time slice prices are resent completely unchanged", () => {
    const reservation = {
      arrival: "2026-10-10T14:00:00+02:00",
      departure: DEPARTURE,
      adults: 2,
      childrenAges: [7],
    };
    const timeSlices = [slice("RP1", 150), slice("RP1", 160), slice("RP1", 170)];
    const payload = buildStayExtensionAmendmentPayload({
      reservation,
      timeSlices,
      extensionPrice: 128,
    });

    expect(payload?.timeSlices.length, "existing 3 nights + 1 new extension night").toBe(4);
    expect(
      payload?.timeSlices.slice(0, 3).map((s) => s.totalGrossAmount.amount),
      "existing nightly prices must be byte-identical to what was already booked",
    ).toEqual([150, 160, 170]);
    expect(payload?.timeSlices.slice(0, 3).every((s) => s.ratePlanId === "RP1")).toBe(true);
  });

  it("buildStayExtensionAmendmentPayload: the new time slice uses ONLY the calculated extension price, never the average or a hard-coded number", () => {
    const reservation = {
      arrival: "2026-10-10T14:00:00+02:00",
      departure: DEPARTURE,
      adults: 2,
      childrenAges: null,
    };
    const timeSlices = [slice("RP1", 200), slice("RP1", 200)];
    const payload = buildStayExtensionAmendmentPayload({
      reservation,
      timeSlices,
      extensionPrice: 128,
    });

    const newSlice = payload?.timeSlices.at(-1);
    expect(newSlice?.totalGrossAmount.amount).toBe(128);
    expect(
      newSlice?.ratePlanId,
      "reuses the reservation's own rate plan, never a different one",
    ).toBe("RP1");
  });

  it("buildStayExtensionAmendmentPayload: preserves arrival/adults/childrenAges, extends departure by exactly one night, and never reprices (requote:false)", () => {
    const reservation = {
      arrival: "2026-10-10T14:00:00+02:00",
      departure: DEPARTURE,
      adults: 3,
      childrenAges: [4, 9],
    };
    const payload = buildStayExtensionAmendmentPayload({
      reservation,
      timeSlices: [slice("RP1", 100)],
      extensionPrice: 80,
    });

    expect(payload?.arrival).toBe(reservation.arrival);
    expect(payload?.departure).toBe("2026-10-17");
    expect(payload?.adults).toBe(3);
    expect(payload?.childrenAges).toEqual([4, 9]);
    expect(payload?.requote).toBe(false);
  });

  it("buildStayExtensionAmendmentPayload: never references channel/OTA fields — channel-neutral by construction", () => {
    const reservation = {
      arrival: "2026-10-10T14:00:00+02:00",
      departure: DEPARTURE,
      adults: 2,
      childrenAges: null,
      channelCode: "ChannelManager",
      source: "Booking.com",
      externalCode: "1234567890-1",
    };
    const payload = buildStayExtensionAmendmentPayload({
      reservation,
      timeSlices: [slice("RP1", 150)],
      extensionPrice: 120,
    });

    expect(Object.keys(payload ?? {}).sort()).toEqual([
      "adults",
      "arrival",
      "childrenAges",
      "departure",
      "requote",
      "timeSlices",
    ]);
  });

  it("buildStayExtensionAmendmentPayload: refuses (null) on a time slice missing ratePlan.id", () => {
    const reservation = { arrival: "2026-10-10T14:00:00+02:00", departure: DEPARTURE, adults: 2 };
    const payload = buildStayExtensionAmendmentPayload({
      reservation,
      timeSlices: [{ totalGrossAmount: { amount: 100, currency: "EUR" } }],
      extensionPrice: 80,
    });
    expect(payload).toBeNull();
  });

  it("buildStayExtensionAmendmentPayload: refuses on a negative extension price", () => {
    const reservation = { arrival: "2026-10-10T14:00:00+02:00", departure: DEPARTURE, adults: 2 };
    expect(
      buildStayExtensionAmendmentPayload({
        reservation,
        timeSlices: [slice("RP1", 100)],
        extensionPrice: -1,
      }),
    ).toBeNull();
  });

  /* 1b. per-night extras, city tax preview/verification, total price preview */

  const STAY = { arrivalDate: "2026-10-10", oldDepartureDate: "2026-10-13", newDate: "2026-10-13" };

  it("findExtendableServices: a per-night extra covering every original night is eligible for extension", () => {
    const services = [
      serviceEntry("HUND", [
        ["2026-10-10", 15],
        ["2026-10-11", 15],
        ["2026-10-12", 15],
      ]),
    ];
    const { toExtend, alreadyExtended } = findExtendableServices({ services, ...STAY });
    expect(toExtend).toHaveLength(1);
    expect(alreadyExtended).toHaveLength(0);
    expect(toExtend[0]?.serviceId).toBe("HUND");
    expect(toExtend[0]?.normalPricePerNight).toEqual({ amount: 15, currency: "EUR" });
    expect(toExtend[0]?.existingDates).toHaveLength(3);
  });

  it("findExtendableServices: a mandatory service (e.g. final cleaning) is never touched, even if dated at the old departure", () => {
    const services = [serviceEntry("FINALCLEAN", [["2026-10-13", 119]], { mandatory: true })];
    expect(findExtendableServices({ services, ...STAY })).toEqual({
      toExtend: [],
      alreadyExtended: [],
    });
  });

  it("findExtendableServices: a single-date arrival/departure-tied service (early check-in, late check-out) is never touched", () => {
    const services = [
      serviceEntry("ECI", [["2026-10-10", 25]]),
      serviceEntry("LCO", [["2026-10-13", 20]]),
    ];
    expect(findExtendableServices({ services, ...STAY })).toEqual({
      toExtend: [],
      alreadyExtended: [],
    });
  });

  it("findExtendableServices: a service whose dates already include the new night is reported as already extended, not re-extended", () => {
    const services = [
      serviceEntry("HUND", [
        ["2026-10-10", 15],
        ["2026-10-11", 15],
        ["2026-10-12", 15],
        ["2026-10-13", 15],
      ]),
    ];
    const { toExtend, alreadyExtended } = findExtendableServices({ services, ...STAY });
    expect(toExtend).toHaveLength(0);
    expect(alreadyExtended).toHaveLength(1);
    expect(alreadyExtended[0]?.serviceId).toBe("HUND");
  });

  it("findExtendableServices: a partial subset of nights (a genuine one-off booking) is never touched", () => {
    const services = [serviceEntry("HUND", [["2026-10-11", 15]])]; // only the middle night
    expect(findExtendableServices({ services, ...STAY })).toEqual({
      toExtend: [],
      alreadyExtended: [],
    });
  });

  it("findExtendableServices: supports any future per-night extra without hardcoding service ids", () => {
    const services = [
      serviceEntry("SOME-FUTURE-EXTRA", [
        ["2026-10-10", 9],
        ["2026-10-11", 9],
        ["2026-10-12", 9],
      ]),
    ];
    const { toExtend } = findExtendableServices({ services, ...STAY });
    expect(toExtend).toHaveLength(1);
    expect(toExtend[0]?.serviceId).toBe("SOME-FUTURE-EXTRA");
  });

  it("buildServiceExtensionDates: existing dates keep their own recorded amount unchanged; only the new date gets the normal price", () => {
    const existingDates = [
      { serviceDate: "2026-10-10", count: 1, amount: { amount: 15, currency: "EUR" } },
      { serviceDate: "2026-10-11", count: 1, amount: { amount: 15, currency: "EUR" } },
    ];
    const dates = buildServiceExtensionDates({
      existingDates,
      newDate: "2026-10-12",
      normalPricePerNight: { amount: 15, currency: "EUR" },
    });
    expect(dates).toHaveLength(3);
    expect(dates.slice(0, 2)).toEqual(existingDates);
    expect(dates[2]).toEqual({
      serviceDate: "2026-10-12",
      count: 1,
      amount: { amount: 15, currency: "EUR" },
    });
  });

  it("findCityTaxAmount: finds the CityTax charge for a specific night among mixed folio charge types", () => {
    const folios = [
      {
        charges: [
          {
            type: "TimeSlice",
            serviceDate: "2026-10-12",
            amount: { grossAmount: 91.13, currency: "EUR" },
          },
          {
            type: "CityTax",
            serviceDate: "2026-10-12",
            amount: { grossAmount: 4, currency: "EUR" },
          },
          {
            type: "ExtraService",
            serviceDate: "2026-10-12",
            amount: { grossAmount: 15, currency: "EUR" },
          },
        ],
      },
    ];
    expect(findCityTaxAmount(folios, "2026-10-12")).toEqual({ amount: 4, currency: "EUR" });
  });

  it("findCityTaxAmount: returns null when no CityTax charge exists for that night (not subject, or verification failure)", () => {
    const folios = [
      {
        charges: [
          {
            type: "TimeSlice",
            serviceDate: "2026-10-12",
            amount: { grossAmount: 91.13, currency: "EUR" },
          },
        ],
      },
    ];
    expect(findCityTaxAmount(folios, "2026-10-12")).toBeNull();
    expect(findCityTaxAmount([], "2026-10-12")).toBeNull();
  });

  it("buildExtensionPricePreview: sums accommodation (already discounted) + extras (normal price) + city tax", () => {
    const total = buildExtensionPricePreview({
      extensionPrice: { amount: 93.5, currency: "EUR" },
      extras: [
        { amount: { amount: 15, currency: "EUR" } },
        { amount: { amount: 15, currency: "EUR" } },
      ],
      cityTax: { amount: 8, currency: "EUR" },
    });
    expect(total).toEqual({ amount: 131.5, currency: "EUR" });
  });

  it("buildExtensionPricePreview: with no extras and no city tax, the total equals the accommodation price alone", () => {
    const total = buildExtensionPricePreview({
      extensionPrice: { amount: 93.5, currency: "EUR" },
      extras: [],
      cityTax: null,
    });
    expect(total).toEqual({ amount: 93.5, currency: "EUR" });
  });

  it("computeExtensionAdditionalTotal: no extras, no city tax (HVQSVNWL-1's exact shape) -> total equals the extension price alone", () => {
    const total = computeExtensionAdditionalTotal({
      extensionPrice: { amount: 148.1, currency: "EUR" },
      extras: [],
      cityTax: { applicable: false, verified: null, amount: null },
    });
    expect(total).toEqual({ amount: 148.1, currency: "EUR" });
  });

  it("computeExtensionAdditionalTotal: sums extension price + genuinely NEW extended extras + verified city tax", () => {
    const extras = [
      { serviceId: "DOG", extended: true, amount: { amount: 15, currency: "EUR" } },
      // "alreadyDone" extras were already billed before this extension — never counted as additional.
      {
        serviceId: "PARKING",
        extended: true,
        alreadyDone: true,
        amount: { amount: 10, currency: "EUR" },
      },
      // A failed extension attempt never added a charge either.
      { serviceId: "BREAKFAST", extended: false, error: "boom" },
    ];
    const cityTax = { applicable: true, verified: true, amount: { amount: 3.5, currency: "EUR" } };
    const total = computeExtensionAdditionalTotal({
      extensionPrice: { amount: 100, currency: "EUR" },
      extras,
      cityTax,
    });
    expect(total).toEqual({ amount: 118.5, currency: "EUR" });
  });

  it("computeExtensionAdditionalTotal: an extended extra missing its amount -> null (never guesses)", () => {
    const extras = [{ serviceId: "DOG", extended: true }];
    expect(
      computeExtensionAdditionalTotal({
        extensionPrice: { amount: 100, currency: "EUR" },
        extras,
        cityTax: null,
      }),
    ).toBeNull();
  });

  it("computeExtensionAdditionalTotal: city tax applicable but never verified -> null (never guesses)", () => {
    const total = computeExtensionAdditionalTotal({
      extensionPrice: { amount: 100, currency: "EUR" },
      extras: [],
      cityTax: { applicable: true, verified: false, amount: null },
    });
    expect(total).toBeNull();
  });

  it("computeExtensionAdditionalTotal: missing extensionPrice -> null", () => {
    expect(
      computeExtensionAdditionalTotal({ extensionPrice: null, extras: [], cityTax: null }),
    ).toBeNull();
  });

  it("determineStayExtensionPhase: status 'InHouse' -> in_house (immediate-CTA compact card), regardless of dates", () => {
    expect(determineStayExtensionPhase({ status: "InHouse", today: TODAY })).toBe("in_house");
    expect(
      determineStayExtensionPhase({
        status: "InHouse",
        arrivalDate: "2026-12-01",
        departureDate: "2026-12-05",
        today: new Date("2026-01-01T00:00:00Z"),
      }),
    ).toBe("in_house");
  });

  it.each([
    [
      "determineStayExtensionPhase: not yet InHouse, but arrival has passed and departure is still in the future -> in_house (date fallback)",
      "2026-10-11T00:00:00Z",
      "in_house",
    ],
    [
      "determineStayExtensionPhase: arrival is today -> already in_house (arrival inclusive)",
      "2026-10-10T00:00:00Z",
      "in_house",
    ],
    [
      "determineStayExtensionPhase: departure is today -> no longer in_house (departure exclusive)",
      "2026-10-13T00:00:00Z",
      "before_arrival",
    ],
  ] as const)("%s", (_name, today, phase) => {
    expect(
      determineStayExtensionPhase({
        status: "Confirmed",
        arrivalDate: "2026-10-10",
        departureDate: "2026-10-13",
        today: new Date(today),
      }),
    ).toBe(phase);
  });

  it("determineStayExtensionPhase: before arrival, any other status, or missing dates -> before_arrival (ANFRAGEN-style compact card)", () => {
    expect(
      determineStayExtensionPhase({
        status: "Confirmed",
        arrivalDate: "2026-10-10",
        departureDate: "2026-10-13",
        today: new Date("2026-10-05T00:00:00Z"),
      }),
    ).toBe("before_arrival");
    expect(determineStayExtensionPhase({ status: "CheckedOut", today: TODAY })).toBe(
      "before_arrival",
    );
    // Extras also calls it with `{}` and with no argument at all; `today` is mandatory in STAY.
    expect(determineStayExtensionPhase({ today: TODAY })).toBe("before_arrival");
  });

  it("findDepartureDateCandidates: a non-mandatory single-date service dated at the old departure is a candidate", () => {
    const candidates = findDepartureDateCandidates({
      services: [serviceEntry("LCO", [["2026-10-13", 20]])],
      oldDepartureDate: "2026-10-13",
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.serviceId).toBe("LCO");
    expect(candidates[0]?.amount).toEqual({ amount: 20, currency: "EUR" });
    expect(candidates[0]?.count).toBe(1);
  });

  it.each([
    [
      "findDepartureDateCandidates: a mandatory single-date service at the old departure is never a candidate",
      serviceEntry("FINALCLEAN", [["2026-10-13", 119]], { mandatory: true }),
    ],
    [
      "findDepartureDateCandidates: a multi-date service is never a candidate, even if one date matches the old departure",
      serviceEntry("HUND", [
        ["2026-10-12", 15],
        ["2026-10-13", 15],
      ]),
    ],
    // already on the new departure
    [
      "findDepartureDateCandidates: a single-date service NOT at the old departure is never a candidate (idempotency: already-moved services are naturally excluded)",
      serviceEntry("LCO", [["2026-10-14", 20]]),
    ],
  ] as const)("%s", (_name, service) => {
    expect(
      findDepartureDateCandidates({ services: [service], oldDepartureDate: "2026-10-13" }),
    ).toHaveLength(0);
  });

  it("buildLateCheckoutMoveDates: exactly one entry, for the new departure date, with the preserved count/amount", () => {
    const dates = buildLateCheckoutMoveDates({
      newDepartureDate: "2026-10-14",
      count: 1,
      amount: { amount: 20, currency: "EUR" },
    });
    expect(dates).toEqual([
      { serviceDate: "2026-10-14", count: 1, amount: { amount: 20, currency: "EUR" } },
    ]);
  });

  const MOVE = {
    serviceId: "LCO",
    oldDepartureDate: "2026-10-13",
    newDepartureDate: "2026-10-14",
    expectedAmount: 20,
    expectedCount: 1,
  };

  it("verifyLateCheckoutMove: true when exactly one date exists, at the new departure, with the exact preserved amount/count", () => {
    expect(
      verifyLateCheckoutMove({ services: [serviceEntry("LCO", [["2026-10-14", 20]])], ...MOVE }),
    ).toBe(true);
  });

  it("verifyLateCheckoutMove: false when the old date is still present, or the amount/count doesn't match, or there's more than one date", () => {
    const cases: [string, [string, number][]][] = [
      ["still on the old date", [["2026-10-13", 20]]],
      ["amount changed", [["2026-10-14", 25]]],
      [
        "a second date was added instead of replacing the first",
        [
          ["2026-10-13", 20],
          ["2026-10-14", 20],
        ],
      ],
    ];
    for (const [message, dates] of cases) {
      expect(
        verifyLateCheckoutMove({ services: [serviceEntry("LCO", dates)], ...MOVE }),
        message,
      ).toBe(false);
    }
  });
});
