import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database } from "./client";
import { externalMappings, properties, tenants, units } from "./schema";
import {
  createTestDatabase,
  expectConstraintViolation,
  type TestDatabase,
} from "./testing/test-database";

let db: Database;
let client: TestDatabase["client"];
let close: () => Promise<void>;

const property = {
  slug: "p",
  displayName: "P",
  spokenName: "P",
  locationName: "Ort",
  timezone: "Europe/Berlin",
};

beforeAll(async () => {
  ({ db, client, close } = await createTestDatabase());
  await db.insert(tenants).values([
    { id: "tenant-a", slug: "tenant-a", name: "Tenant A" },
    { id: "tenant-b", slug: "tenant-b", name: "Tenant B" },
  ]);
  await db.insert(properties).values([
    { ...property, id: "prop-a", tenantId: "tenant-a", slug: "shared-slug" },
    { ...property, id: "prop-b", tenantId: "tenant-b", slug: "shared-slug" },
  ]);
  await db.insert(units).values([
    { id: "unit-a", tenantId: "tenant-a", propertyId: "prop-a", slug: "u1", displayName: "U1" },
    { id: "unit-b", tenantId: "tenant-b", propertyId: "prop-b", slug: "u1", displayName: "U1" },
  ]);
});

afterAll(async () => {
  await close();
});

describe("schema constraints", () => {
  it("enables row level security on every table", async () => {
    const result = await client.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname <> '__drizzle_migrations'`,
    );
    expect(result.rows).toHaveLength(12);
    expect(result.rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  it("rejects malformed ids and slugs", async () => {
    await expectConstraintViolation(
      db.insert(tenants).values({ id: "Tenant C", slug: "tenant-c", name: "C" }),
      "tenants_id_format",
    );
    await expectConstraintViolation(
      db
        .insert(properties)
        .values({ ...property, id: "prop-x", tenantId: "tenant-a", slug: "HØV" }),
      "properties_slug_format",
    );
  });

  it("rejects blank names", async () => {
    await expectConstraintViolation(
      db.insert(tenants).values({ id: "tenant-c", slug: "tenant-c", name: "   " }),
      "tenants_name_not_blank",
    );
  });

  it("keeps tenant slugs globally unique", async () => {
    await expectConstraintViolation(
      db.insert(tenants).values({ id: "tenant-c", slug: "tenant-a", name: "C" }),
      "tenants_slug_key",
    );
  });

  it("scopes property slugs to the tenant", async () => {
    // "shared-slug" exists in both tenants (beforeAll) – but not twice in one tenant.
    await expectConstraintViolation(
      db
        .insert(properties)
        .values({ ...property, id: "prop-a2", tenantId: "tenant-a", slug: "shared-slug" }),
      "properties_tenant_id_slug_key",
    );
  });

  it("requires every property to belong to an existing tenant", async () => {
    await expectConstraintViolation(
      db.insert(properties).values({ ...property, id: "prop-x", tenantId: "nobody" }),
      "properties_tenant_id_tenants_id_fk",
    );
  });

  it("requires a unit's property to belong to the same tenant", async () => {
    await expectConstraintViolation(
      db.insert(units).values({
        id: "unit-x",
        tenantId: "tenant-a",
        propertyId: "prop-b",
        slug: "u2",
        displayName: "U2",
      }),
      "units_property_fkey",
    );
  });

  it("scopes unit slugs to the property", async () => {
    await expectConstraintViolation(
      db.insert(units).values({
        id: "unit-a2",
        tenantId: "tenant-a",
        propertyId: "prop-a",
        slug: "u1",
        displayName: "U1",
      }),
      "units_property_id_slug_key",
    );
  });
});

describe("external_mappings constraints", () => {
  const mapping = { tenantId: "tenant-a", provider: "apaleo", entityType: "property" } as const;

  beforeAll(async () => {
    await db.insert(externalMappings).values([
      { ...mapping, internalEntityId: "prop-a", externalId: "EXT-1" },
      { ...mapping, entityType: "unit", internalEntityId: "unit-a", externalId: "EXT-1-U" },
      // The same external id in another tenant (another PMS account) is fine.
      { ...mapping, tenantId: "tenant-b", internalEntityId: "prop-b", externalId: "EXT-1" },
    ]);
  });

  it("maps one external id to exactly one internal entity", async () => {
    await expectConstraintViolation(
      db
        .insert(externalMappings)
        .values({ ...mapping, internalEntityId: "prop-a", externalId: "EXT-1" }),
      "external_mappings_external_key",
    );
  });

  it("allows at most one external id per entity and provider", async () => {
    await expectConstraintViolation(
      db
        .insert(externalMappings)
        .values({ ...mapping, internalEntityId: "prop-a", externalId: "EXT-2" }),
      "external_mappings_internal_key",
    );
  });

  it("requires the mapped property to exist in the same tenant", async () => {
    await expectConstraintViolation(
      db
        .insert(externalMappings)
        .values({ ...mapping, internalEntityId: "missing", externalId: "EXT-3" }),
      "external_mappings_property_fkey",
    );
    await expectConstraintViolation(
      db
        .insert(externalMappings)
        .values({ ...mapping, internalEntityId: "prop-b", externalId: "EXT-3" }),
      "external_mappings_property_fkey",
    );
  });

  it("requires the mapped unit to exist in the same tenant", async () => {
    await expectConstraintViolation(
      db.insert(externalMappings).values({
        ...mapping,
        entityType: "unit",
        internalEntityId: "unit-b",
        externalId: "EXT-4",
      }),
      "external_mappings_unit_fkey",
    );
  });

  it("rejects unknown providers and entity types", async () => {
    await expectConstraintViolation(
      db.execute(sql`INSERT INTO external_mappings (tenant_id, provider, entity_type, internal_entity_id, external_id)
                     VALUES ('tenant-a', 'nuki', 'property', 'prop-a', 'EXT-5')`),
      "external_mappings_provider_valid",
    );
    await expectConstraintViolation(
      db.execute(sql`INSERT INTO external_mappings (tenant_id, provider, entity_type, internal_entity_id, external_id)
                     VALUES ('tenant-a', 'apaleo', 'reservation', 'prop-a', 'EXT-5')`),
      "external_mappings_entity_type_valid",
    );
  });

  it("rejects blank external ids", async () => {
    await expectConstraintViolation(
      db
        .insert(externalMappings)
        .values({ ...mapping, internalEntityId: "prop-a", externalId: " " }),
      "external_mappings_external_id_not_blank",
    );
  });

  it("protects mapped entities from deletion", async () => {
    await expectConstraintViolation(
      db.execute(sql`DELETE FROM units WHERE id = 'unit-a'`),
      "external_mappings_unit_fkey",
    );
  });
});
