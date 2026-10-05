import { previewFixturesSeed, tenantSeedSchema, uniquePlacesSeed } from "@up/db";
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

  it("keeps the Apaleo TEST property out of the master data seed – only in preview fixtures", () => {
    const testProperties = propertyRegistry.filter((property) => property.testOnly);
    expect(uniquePlacesSeed.properties.map((seeded) => seeded.id)).not.toContain("test-run");
    expect(
      testProperties.map((property) => ({
        id: property.id,
        tenantId: property.tenantId,
        displayName: property.name,
        apaleoId: property.pms.propertyId,
        units: property.units.map((unit) => ({ id: unit.id, apaleoId: unit.externalId })),
      })),
    ).toEqual(
      tenantSeedSchema.parse(previewFixturesSeed).properties.map((property) => ({
        id: property.id,
        tenantId: previewFixturesSeed.tenant.id,
        displayName: property.displayName,
        apaleoId: property.externalIds.apaleo,
        units: property.units.map((unit) => ({ id: unit.id, apaleoId: unit.externalIds.apaleo })),
      })),
    );
  });
});
