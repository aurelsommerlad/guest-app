import { describe, expect, it } from "vitest";

import {
  isEntityKey,
  isExternalEntityType,
  isExternalProvider,
  isValidTimeZone,
} from "./tenancy-model";

describe("tenancy model guards", () => {
  it("accepts lowercase entity keys and rejects everything else", () => {
    expect(isEntityKey("hov")).toBe(true);
    expect(isEntityKey("unique-places")).toBe(true);
    expect(isEntityKey("test-ap-1")).toBe(true);
    for (const invalid of ["", "HOV", "-hov", "h ov", "høv", "a".repeat(65), "hov_1"]) {
      expect(isEntityKey(invalid)).toBe(false);
    }
  });

  it("knows only the supported providers and entity types", () => {
    expect(isExternalProvider("apaleo")).toBe(true);
    expect(isExternalProvider("nuki")).toBe(false);
    expect(isExternalProvider("Apaleo")).toBe(false);
    expect(isExternalEntityType("property")).toBe(true);
    expect(isExternalEntityType("unit")).toBe(true);
    expect(isExternalEntityType("reservation")).toBe(false);
  });

  it("validates IANA time zones", () => {
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("Europe/Vienna")).toBe(true);
    expect(isValidTimeZone("Europe/Altusried")).toBe(false);
  });
});
