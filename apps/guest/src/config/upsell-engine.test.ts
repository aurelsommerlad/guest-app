import { describe, expect, it } from "vitest";

import { propertyRegistry } from "./properties";
import { stayEngineEnabled } from "./upsell";

describe("M4 feature switch: STAY engine in the guest app", () => {
  it("serves only the test property mapped to Apaleo TEST, and only with GUEST_SERVICE_ENGINE=test", () => {
    const enabled = propertyRegistry.filter((p) => stayEngineEnabled(p, "test")).map((p) => p.id);
    expect(enabled).toEqual(["test-run"]);
    expect(propertyRegistry.filter((p) => stayEngineEnabled(p, "off"))).toEqual([]);
  });

  it("never serves a real property, even if it were configured like TEST", () => {
    const real = propertyRegistry.find((p) => !p.testOnly);
    if (!real) throw new Error("no real property in the registry");
    expect(
      stayEngineEnabled({ ...real, design: "v2", upsell: "v1", extras: "bridge" }, "test"),
    ).toBe(false);
    const testOtherApaleo = propertyRegistry.find((p) => p.id === "test-run");
    if (!testOtherApaleo) throw new Error("no test property");
    expect(
      stayEngineEnabled(
        { ...testOtherApaleo, pms: { provider: "apaleo", propertyId: "HUESLE" } },
        "test",
      ),
    ).toBe(false);
  });
});
