import { describe, expect, it } from "vitest";

import {
  isBookableConfig,
  normalizeBoolean,
  normalizeVehiclePlate,
  parsePriceToCents,
  serviceConfigIssues,
} from "./config-normalization";
import {
  resolveStayExtensionSettings,
  resolveStayExtensionSettingsDetailed,
} from "./stay-extension";

describe("boolean normalization (historic values)", () => {
  it.each([
    [true, true, false],
    [false, false, false],
    ["true", true, true],
    ["TRUE ", true, true],
    ["1", true, true],
    [1, true, true],
    ["ja", true, true],
    ["false", false, true],
    ["0", false, true],
    [0, false, true],
    ["", false, true],
    [null, false, false],
    [undefined, false, false],
  ])("%j → %s (normalized: %s)", (input, value, normalized) => {
    expect(normalizeBoolean(input)).toEqual({ value, normalized });
  });
});

describe("licence plates are validated text", () => {
  it("normalizes case and spaces", () => {
    expect(normalizeVehiclePlate(" m-ab  1234 ")).toBe("M-AB 1234");
    expect(normalizeVehiclePlate("OA-Ü 77")).toBe("OA-Ü 77");
  });
  it("rejects non-text and implausible values", () => {
    for (const value of [123, null, "", " ", "A", "<script>", "AB_12", "X".repeat(13)]) {
      expect(normalizeVehiclePlate(value)).toBeNull();
    }
  });
});

describe("additional guests without a valid price are never free", () => {
  const base = {
    extrasServiceId: "HOV-EXTRA",
    actionType: "increase_occupancy",
    fulfillment: "instant",
    requiresRemainingCapacity: true,
  };
  it("flags a missing or invalid price as a configuration error", () => {
    expect(serviceConfigIssues({ ...base, extraPersonPriceCents: null })).toEqual([
      "missing_extra_person_price",
    ]);
    expect(serviceConfigIssues({ ...base, extraPersonPriceCents: -1 })).toEqual([
      "invalid_extra_person_price",
    ]);
    expect(isBookableConfig({ ...base, extraPersonPriceCents: null })).toBe(false);
  });
  it("accepts an explicit 0 € (deliberately free) and normal prices", () => {
    expect(isBookableConfig({ ...base, extraPersonPriceCents: 0 })).toBe(true);
    expect(isBookableConfig({ ...base, extraPersonPriceCents: 3500 })).toBe(true);
  });
  it("flags services without an Apaleo service and inconsistent occupancy rules", () => {
    expect(serviceConfigIssues({ actionType: "service" })).toEqual(["missing_apaleo_service"]);
    expect(
      serviceConfigIssues({
        ...base,
        extraPersonPriceCents: 100,
        fulfillment: "request",
        requiresRemainingCapacity: false,
      }),
    ).toEqual(["occupancy_requires_instant", "occupancy_requires_capacity_rule"]);
  });
  it("parses form prices to cents", () => {
    expect(parsePriceToCents("35")).toBe(3500);
    expect(parsePriceToCents("35,5")).toBe(3550);
    expect(parsePriceToCents(" ")).toBeNull();
    expect(parsePriceToCents("abc")).toBeNaN();
    expect(parsePriceToCents("-3")).toBeNaN();
  });
});

describe("extension discounts: empty = 0 %, missing = explicit fallback", () => {
  it("treats an empty discount as 0 % (not the default)", () => {
    const { settings, notes } = resolveStayExtensionSettingsDetailed({
      extensionNightEnabled: true,
      extensionDiscountPreArrivalOneNightGap: null,
      extensionDiscountPreArrivalStandard: "",
      extensionDiscountInHouseOneNightGap: 20,
      extensionDiscountInHouseStandard: 15,
    });
    expect(settings.extensionDiscountPreArrivalOneNightGap).toBe(0);
    expect(settings.extensionDiscountPreArrivalStandard).toBe(0);
    expect(notes).toEqual(
      expect.arrayContaining([
        "empty_discount:extensionDiscountPreArrivalOneNightGap",
        "empty_discount:extensionDiscountPreArrivalStandard",
      ]),
    );
  });
  it("falls back for a missing field: legacy flat field, then the documented default", () => {
    expect(resolveStayExtensionSettings({ extensionDiscountStandard: 7 })).toMatchObject({
      extensionDiscountPreArrivalStandard: 7,
      extensionDiscountInHouseStandard: 7,
      extensionDiscountPreArrivalOneNightGap: 15,
    });
    expect(resolveStayExtensionSettings({ extensionDiscountOneNightGap: "" })).toMatchObject({
      extensionDiscountPreArrivalOneNightGap: 0,
      extensionDiscountInHouseOneNightGap: 0,
    });
  });
  it('normalizes a historic "true" for the enabled flag and reports it', () => {
    const { settings, notes } = resolveStayExtensionSettingsDetailed({
      extensionNightEnabled: "true",
    });
    expect(settings.extensionNightEnabled).toBe(true);
    expect(notes).toContain("boolean_normalized:extensionNightEnabled");
  });
});

describe("M4: stored values are interpreted safely", () => {
  it('treats historic text values such as "false" as disabled', () => {
    for (const value of ["false", "False", "0", "nein", "off", "no", "", null, undefined, 0]) {
      expect(normalizeBoolean(value).value).toBe(false);
    }
    for (const value of ["true", "1", "ja", "yes", "on", true, 1]) {
      expect(normalizeBoolean(value).value).toBe(true);
    }
  });

  it("allows an explicitly configured 0 € additional guest but blocks a missing price", () => {
    const base = {
      actionType: "increase_occupancy",
      fulfillment: "instant",
      requiresRemainingCapacity: true,
      extrasServiceId: "X",
    } as const;
    expect(serviceConfigIssues({ ...base, extraPersonPriceCents: 0 })).toEqual([]);
    expect(serviceConfigIssues({ ...base, extraPersonPriceCents: null })).toContain(
      "missing_extra_person_price",
    );
    expect(parsePriceToCents("0")).toBe(0);
    expect(parsePriceToCents("0,00")).toBe(0);
    expect(parsePriceToCents("")).toBeNull();
  });
});
