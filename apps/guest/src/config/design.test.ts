import { describe, expect, it } from "vitest";

import { designOf } from "./design";
import { findPropertyById, propertyRegistry } from "./properties";

describe("guest design per property", () => {
  it("TEST uses Design V2, every real property the current design", () => {
    for (const property of propertyRegistry) {
      expect(designOf(property)).toBe(property.id === "test-run" ? "v2" : "current");
    }
  });

  it("ignores a V2 switch on a real property", () => {
    const hov = findPropertyById("hov");
    if (!hov) throw new Error("hov missing");
    expect(designOf({ ...hov, design: "v2" })).toBe("current");
  });
});
