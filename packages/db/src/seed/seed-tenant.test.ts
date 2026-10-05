import { count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type Database } from "../client";
import { externalMappings, properties, tenants, units } from "../schema";
import { createTestDatabase } from "../testing/test-database";
import { type TenantSeedInput } from "./seed-data";
import { SeedConflictError, seedTenant } from "./seed-tenant";
import { uniquePlacesSeed } from "./unique-places";

/** A standalone property (not part of the UNIQUE PLACES seed) for edge cases. */
const huesle = {
  id: "huesle",
  slug: "huesle",
  displayName: "HŪSLE",
  spokenName: "Husle",
  locationName: "Bludenz",
  timezone: "Europe/Vienna",
};

let db: Database;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDatabase());
});

afterEach(async () => {
  await close();
});

async function rowCounts() {
  const [[t], [p], [u], [m]] = await Promise.all([
    db.select({ n: count() }).from(tenants),
    db.select({ n: count() }).from(properties),
    db.select({ n: count() }).from(units),
    db.select({ n: count() }).from(externalMappings),
  ]);
  return { tenants: t?.n, properties: p?.n, units: u?.n, externalMappings: m?.n };
}

describe("UNIQUE PLACES seed", () => {
  it("creates the tenant, four properties, the HØV units and their Apaleo mappings", async () => {
    const result = await seedTenant(db, uniquePlacesSeed);
    expect(result.written).toEqual({ tenants: 1, properties: 4, units: 8, externalMappings: 12 });
    expect(await rowCounts()).toEqual({
      tenants: 1,
      properties: 4,
      units: 8,
      externalMappings: 12,
    });

    const seeded = await db.select().from(properties).orderBy(properties.id);
    expect(seeded.map((property) => property.displayName)).toEqual([
      "ΛLPILΛ",
      "HØV",
      "HŪSLE",
      "LÆKE",
    ]);
    expect(seeded.every((property) => property.tenantId === "unique-places")).toBe(true);
  });

  it("does not seed the Apaleo TEST property", async () => {
    await seedTenant(db, uniquePlacesSeed);
    const mapped = await db
      .select()
      .from(externalMappings)
      .where(eq(externalMappings.externalId, "TEST"));
    expect(mapped).toEqual([]);
    expect(await db.select().from(properties).where(eq(properties.id, "test-run"))).toEqual([]);
  });

  it("is idempotent: a second run writes nothing and keeps timestamps", async () => {
    await seedTenant(db, uniquePlacesSeed);
    const before = await db.select().from(units).orderBy(units.id);

    const second = await seedTenant(db, uniquePlacesSeed);

    expect(second.written).toEqual({ tenants: 0, properties: 0, units: 0, externalMappings: 0 });
    expect(await rowCounts()).toEqual({
      tenants: 1,
      properties: 4,
      units: 8,
      externalMappings: 12,
    });
    expect(await db.select().from(units).orderBy(units.id)).toEqual(before);
  });

  it("updates only what changed", async () => {
    await seedTenant(db, uniquePlacesSeed);
    const changed: TenantSeedInput = {
      ...uniquePlacesSeed,
      properties: uniquePlacesSeed.properties.map((property) =>
        property.id === "laeke" ? { ...property, locationName: "Lindau (Bodensee)" } : property,
      ),
    };
    const result = await seedTenant(db, changed);
    expect(result.written).toEqual({ tenants: 0, properties: 1, units: 0, externalMappings: 0 });
  });

  it("never moves an id that belongs to another tenant", async () => {
    await seedTenant(db, uniquePlacesSeed);
    const intruder: TenantSeedInput = {
      tenant: { id: "other", slug: "other", name: "Other" },
      properties: [huesle],
    };
    await expect(seedTenant(db, intruder)).rejects.toBeInstanceOf(SeedConflictError);
    // Rolled back as a whole: the other tenant was not created either.
    expect(await rowCounts()).toEqual({
      tenants: 1,
      properties: 4,
      units: 8,
      externalMappings: 12,
    });
  });

  it("validates the seed before writing", async () => {
    const duplicateApaleoId: TenantSeedInput = {
      ...uniquePlacesSeed,
      properties: [
        ...uniquePlacesSeed.properties,
        {
          id: "copy",
          slug: "copy",
          displayName: "Copy",
          spokenName: "Copy",
          locationName: "Ort",
          timezone: "Europe/Berlin",
          externalIds: { apaleo: "ALTUS" },
        },
      ],
    };
    await expect(seedTenant(db, duplicateApaleoId)).rejects.toThrow(
      /duplicate apaleo property id: ALTUS/,
    );

    const invalidTimezone: TenantSeedInput = {
      tenant: uniquePlacesSeed.tenant,
      properties: [{ ...huesle, timezone: "Europe/Bludenz" }],
    };
    await expect(seedTenant(db, invalidTimezone)).rejects.toThrow(/IANA/);
    expect(await rowCounts()).toEqual({ tenants: 0, properties: 0, units: 0, externalMappings: 0 });
  });
});
