import { tenantSeedSchema, uniquePlacesSeed } from "@up/db";
import { describe, expect, it } from "vitest";

import { propertyRegistry } from "./properties";

/**
 * Until the app reads properties from the database (own phase), the code registry and
 * the database seed must describe exactly the same master data – no competing models.
 */
describe("property registry ↔ database seed", () => {
  const regular = propertyRegistry.filter((property) => !property.testOnly);

  it("belongs to the seeded tenant", () => {
    expect(new Set(regular.map((property) => property.tenantId))).toEqual(
      new Set([uniquePlacesSeed.tenant.id]),
    );
  });

  it("describes the same properties, units and Apaleo ids", () => {
    const fromRegistry = regular.map((property) => ({
      id: property.id,
      displayName: property.name,
      spokenName: property.spokenName,
      locationName: property.location,
      timezone: property.timeZone,
      apaleoId: property.pms.propertyId,
      units: property.units.map((unit) => ({
        id: unit.id,
        displayName: unit.name,
        apaleoId: unit.externalId,
      })),
    }));
    const fromSeed = tenantSeedSchema.parse(uniquePlacesSeed).properties.map((property) => ({
      id: property.id,
      displayName: property.displayName,
      spokenName: property.spokenName,
      locationName: property.locationName,
      timezone: property.timezone,
      apaleoId: property.externalIds.apaleo,
      units: property.units.map((unit) => ({
        id: unit.id,
        displayName: unit.displayName,
        apaleoId: unit.externalIds.apaleo,
      })),
    }));
    expect(fromSeed).toEqual(fromRegistry);
  });

  it("keeps the Apaleo TEST property out of the seed", () => {
    const testProperties = propertyRegistry.filter((property) => property.testOnly);
    expect(testProperties.map((property) => property.pms.propertyId)).toEqual(["TEST"]);
    for (const property of testProperties) {
      expect(uniquePlacesSeed.properties.map((seeded) => seeded.id)).not.toContain(property.id);
    }
  });
});
