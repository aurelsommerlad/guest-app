import { describe, expect, it } from "vitest";

import { accessWindowPolicyFor, TEST_PROPERTY_ACCESS_WINDOW } from "./access-window-policy";

const tenantId = "unique-places";

describe("accessWindowPolicyFor", () => {
  it("opens test properties early outside production", () => {
    expect(accessWindowPolicyFor("staging", { tenantId, propertyId: "test-run" })).toEqual(
      TEST_PROPERTY_ACCESS_WINDOW,
    );
    expect(accessWindowPolicyFor("local", { tenantId, propertyId: "test-run" })).toEqual(
      TEST_PROPERTY_ACCESS_WINDOW,
    );
  });

  it("never deviates in production", () => {
    expect(
      accessWindowPolicyFor("production", { tenantId, propertyId: "test-run" }),
    ).toBeUndefined();
  });

  it("keeps the default for real properties", () => {
    for (const propertyId of ["hov", "laeke", "huesle", "alpila"]) {
      expect(accessWindowPolicyFor("staging", { tenantId, propertyId })).toBeUndefined();
    }
  });

  it("applies only to the test property's own tenant and known properties", () => {
    expect(
      accessWindowPolicyFor("staging", { tenantId: "other-tenant", propertyId: "test-run" }),
    ).toBeUndefined();
    expect(accessWindowPolicyFor("staging", { tenantId, propertyId: "unknown" })).toBeUndefined();
  });
});
