import { describe, expect, it } from "vitest";

import { type AddressEvidence, addressIssues, assessAddress, sameAddress } from "./address-check";
import { checkPostalCode } from "./postal-codes";

const home = { street: "Seestraße 12", postalCode: "88131", city: "Lindau", country: "DE" };

describe("postal codes", () => {
  it.each([
    ["DE", "88131", "ok"],
    ["DE", "8813", "invalid-format"],
    ["AT", "6900", "ok"],
    ["AT", "69000", "invalid-format"],
    ["CH", "8001", "ok"],
    ["NL", "1012 ab", "ok"],
    ["GB", "sw1a 1aa", "ok"],
    ["PL", "00-950", "ok"],
    ["PT", "1000-001", "ok"],
    ["US", "10001-1234", "ok"],
    ["DE", "", "missing"],
    ["DE", undefined, "missing"],
    ["HK", undefined, "ok"],
    ["KE", "00100", "not-checked"],
  ] as const)("%s %s → %s", (country, code, expected) => {
    expect(checkPostalCode(country, code)).toBe(expected);
  });
});

describe("addressIssues (formally valid)", () => {
  it("accepts a complete German address", () => {
    expect(addressIssues(home)).toEqual([]);
  });

  it("reports every missing part", () => {
    expect(addressIssues({ country: "DE" })).toEqual([
      { field: "street", code: "required" },
      { field: "city", code: "required" },
      { field: "postalCode", code: "required" },
    ]);
  });

  it("rejects markup, control characters and unknown countries", () => {
    expect(addressIssues({ ...home, street: "<script>" })).toContainEqual({
      field: "street",
      code: "invalid",
    });
    expect(addressIssues({ ...home, city: "Lin\u0007dau" })).toContainEqual({
      field: "city",
      code: "invalid",
    });
    expect(addressIssues({ ...home, country: "XX" })).toEqual([
      { field: "country", code: "invalid" },
    ]);
  });

  it("checks the postal code against the country", () => {
    expect(addressIssues({ ...home, country: "AT" })).toEqual([
      { field: "postalCode", code: "invalid-format" },
    ]);
  });

  it("allows an international address without known pattern", () => {
    expect(
      addressIssues({
        street: "Ngong Road 5",
        postalCode: "00100",
        city: "Nairobi",
        country: "KE",
      }),
    ).toEqual([]);
  });
});

describe("sameAddress", () => {
  it("ignores case, spacing and the Str./Straße spelling", () => {
    expect(
      sameAddress(home, {
        street: "seestr. 12",
        postalCode: " 88131 ",
        city: "LINDAU",
        country: "de",
      }),
    ).toBe(true);
  });

  it("detects a different house number", () => {
    expect(sameAddress(home, { ...home, street: "Seestraße 14" })).toBe(false);
  });
});

describe("assessAddress", () => {
  const validation = (
    over: Partial<Extract<AddressEvidence, { kind: "provider-validation" }>> = {},
  ) =>
    ({
      kind: "provider-validation",
      granularity: "premise",
      complete: true,
      corrected: false,
      standardized: home,
      ...over,
    }) as const;

  it("incomplete → unverified with issues", () => {
    const result = assessAddress({ street: "Seestraße 12", country: "DE" });
    expect(result.status).toBe("unverified");
    expect(result.reason).toBe("incomplete");
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("manual entry without provider → formally valid (never more)", () => {
    expect(assessAddress(home)).toMatchObject({ status: "formally-valid", reason: "no-evidence" });
  });

  it("provider outage keeps the check-in going as formally valid", () => {
    expect(assessAddress(home, undefined, { providerUnavailable: true })).toMatchObject({
      status: "formally-valid",
      reason: "provider-unavailable",
    });
  });

  it("building-level match of the exact address → postally plausible", () => {
    expect(assessAddress(home, validation()).status).toBe("postally-plausible");
    expect(assessAddress(home, validation({ granularity: "sub-premise" })).status).toBe(
      "postally-plausible",
    );
  });

  it("street- or city-level matches are not enough", () => {
    expect(assessAddress(home, validation({ granularity: "route" }))).toMatchObject({
      status: "formally-valid",
      reason: "coarse-match",
    });
    expect(assessAddress(home, validation({ granularity: "locality" })).status).toBe(
      "formally-valid",
    );
  });

  it("corrected or incomplete provider answers are not plausible", () => {
    expect(assessAddress(home, validation({ corrected: true })).reason).toBe("provider-corrected");
    expect(assessAddress(home, validation({ complete: false })).reason).toBe("provider-corrected");
  });

  it("an address changed after the match loses plausibility", () => {
    const edited = { ...home, street: "Seestraße 99" };
    expect(assessAddress(edited, validation())).toMatchObject({
      status: "formally-valid",
      reason: "changed-after-match",
    });
    expect(
      assessAddress(edited, {
        kind: "autocomplete-selection",
        granularity: "premise",
        selected: home,
      }),
    ).toMatchObject({ status: "formally-valid", reason: "changed-after-match" });
  });

  it("an unchanged autocomplete pick at building level is plausible", () => {
    expect(
      assessAddress(home, {
        kind: "autocomplete-selection",
        granularity: "premise",
        selected: home,
      }).status,
    ).toBe("postally-plausible");
  });

  it("never produces a 'verified' status", () => {
    const all = [
      assessAddress(home),
      assessAddress(home, validation()),
      assessAddress({}, validation()),
    ].map((result) => result.status as string);
    expect(all).not.toContain("verified");
  });
});
