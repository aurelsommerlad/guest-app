import { describe, expect, it } from "vitest";

import { paymentConfigOf } from "./payment";
import { findPropertyById, propertyRegistry } from "./properties";

describe("payment settings per property (Phase 12 A)", () => {
  it("only TEST shows payments (inform); every real property is off", () => {
    for (const property of propertyRegistry) {
      expect(paymentConfigOf(property).mode).toBe(property.id === "test-run" ? "inform" : "off");
    }
  });

  it("ignores payment settings on a real property", () => {
    const hov = findPropertyById("hov");
    if (!hov) throw new Error("hov missing");
    const configured = {
      ...hov,
      payment: { mode: "inform", due: { rule: "at-booking" }, otaWithoutSignal: "review" },
    } as const;
    expect(paymentConfigOf(configured).mode).toBe("off");
  });

  it("never enforces (locks) before Phase C – at most inform", () => {
    const test = findPropertyById("test-run");
    if (!test) throw new Error("test-run missing");
    const enforcing = {
      ...test,
      payment: {
        mode: "enforce",
        due: { rule: "at-free-cancellation-end" },
        otaWithoutSignal: "review",
      },
    } as const;
    expect(paymentConfigOf(enforcing).mode).toBe("inform");
  });
});
