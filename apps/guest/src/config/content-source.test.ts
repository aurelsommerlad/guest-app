import { describe, expect, it } from "vitest";

import { contentScopeOf } from "./content-source";
import { findPropertyById, propertyRegistry, type RegisteredProperty } from "./properties";

function registered(id: string): RegisteredProperty {
  const property = findPropertyById(id);
  if (!property) throw new Error(`${id} missing`);
  return property;
}

const test = registered("test-run");
const hov = registered("hov");

describe("content source of test properties", () => {
  it("TEST shows HØV's content; Ap. 1 as ROS, Ap. 2 the general HØV content", () => {
    expect(contentScopeOf("unique-places", test, "test-ap-1")).toEqual({
      tenantId: "unique-places",
      propertyId: "hov",
      unitId: "ros",
    });
    expect(contentScopeOf("unique-places", test, "test-ap-2")).toEqual({
      tenantId: "unique-places",
      propertyId: "hov",
    });
    expect(contentScopeOf("unique-places", test, undefined)).toEqual({
      tenantId: "unique-places",
      propertyId: "hov",
    });
  });

  it("real properties always read their own content", () => {
    expect(contentScopeOf("unique-places", hov, "ros")).toEqual({
      tenantId: "unique-places",
      propertyId: "hov",
      unitId: "ros",
    });
    // Even a (mis)configured link on a real property is ignored.
    const misconfigured: RegisteredProperty = { ...hov, contentSource: { propertyId: "laeke" } };
    expect(contentScopeOf("unique-places", misconfigured, "ros").propertyId).toBe("hov");
  });

  it("falls back to the own content when a guard fails", () => {
    const lookup = (id: string) => propertyRegistry.find((property) => property.id === id);
    const otherTenant = (id: string) => {
      const found = lookup(id);
      return found ? { ...found, tenantId: "other-tenant" } : undefined;
    };
    expect(contentScopeOf("unique-places", test, "test-ap-1", otherTenant).propertyId).toBe(
      "test-run",
    );
    // A guest of another tenant never reaches this tenant's content through the link.
    expect(contentScopeOf("other-tenant", test, "test-ap-1")).toEqual({
      tenantId: "other-tenant",
      propertyId: "test-run",
      unitId: "test-ap-1",
    });
    const toTest: RegisteredProperty = { ...test, contentSource: { propertyId: "test-run" } };
    expect(contentScopeOf("unique-places", toTest, "test-ap-1").propertyId).toBe("test-run");
    const unknown: RegisteredProperty = { ...test, contentSource: { propertyId: "nowhere" } };
    expect(contentScopeOf("unique-places", unknown, "test-ap-1").propertyId).toBe("test-run");
    // A mapped unit that is not the source's own: general content of the source only.
    const foreignUnit: RegisteredProperty = {
      ...test,
      contentSource: { propertyId: "hov", units: { "test-ap-1": "test-ap-2" } },
    };
    expect(contentScopeOf("unique-places", foreignUnit, "test-ap-1")).toEqual({
      tenantId: "unique-places",
      propertyId: "hov",
    });
  });

  it("registry: only test properties link, to a real property of the same tenant and its units", () => {
    for (const property of propertyRegistry) {
      if (!property.contentSource) continue;
      expect(property.testOnly).toBe(true);
      const source = findPropertyById(property.contentSource.propertyId);
      expect(source?.testOnly).toBeFalsy();
      expect(source?.tenantId).toBe(property.tenantId);
      for (const [own, mapped] of Object.entries(property.contentSource.units ?? {})) {
        expect(property.units.map((unit) => unit.id)).toContain(own);
        expect(source?.units.map((unit) => unit.id)).toContain(mapped);
      }
    }
  });
});
