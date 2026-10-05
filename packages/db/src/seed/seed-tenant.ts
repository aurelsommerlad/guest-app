import { EXTERNAL_PROVIDERS } from "@up/core";
import { inArray, ne, or, sql, type SQL, and } from "drizzle-orm";
import { type AnyPgColumn } from "drizzle-orm/pg-core";

import { type Database } from "../client";
import { externalMappings, properties, tenants, units } from "../schema";
import { type TenantSeedInput, tenantSeedSchema } from "./seed-data";

export type SeedResult = {
  /** Rows inserted or changed per table. 0 everywhere = database already up to date. */
  written: { tenants: number; properties: number; units: number; externalMappings: number };
};

export class SeedConflictError extends Error {
  override name = "SeedConflictError";
}

/** ON CONFLICT … DO UPDATE only when a value actually differs (keeps updated_at stable). */
function changed(columns: readonly AnyPgColumn[]): SQL {
  return or(
    ...columns.map(
      (column) => sql`${column} IS DISTINCT FROM excluded.${sql.identifier(column.name)}`,
    ),
  ) as SQL;
}

/**
 * Idempotent upsert of one tenant's master data in a single transaction.
 *
 * - Never deletes: entities missing from the seed stay untouched.
 * - Never moves an entity to another tenant: an id owned by a different tenant aborts.
 * - Running it twice writes nothing the second time.
 */
export async function seedTenant(db: Database, input: TenantSeedInput): Promise<SeedResult> {
  const seed = tenantSeedSchema.parse(input);
  const tenantId = seed.tenant.id;
  const unitRows = seed.properties.flatMap((property) =>
    property.units.map((unit) => ({ ...unit, propertyId: property.id })),
  );

  return db.transaction(async (tx) => {
    const propertyIds = seed.properties.map((property) => property.id);
    const unitIds = unitRows.map((unit) => unit.id);
    const foreign = [
      ...(propertyIds.length
        ? await tx
            .select({ id: properties.id })
            .from(properties)
            .where(and(inArray(properties.id, propertyIds), ne(properties.tenantId, tenantId)))
        : []),
      ...(unitIds.length
        ? await tx
            .select({ id: units.id })
            .from(units)
            .where(and(inArray(units.id, unitIds), ne(units.tenantId, tenantId)))
        : []),
    ];
    if (foreign.length > 0) {
      throw new SeedConflictError(
        `ids already belong to another tenant: ${foreign.map((row) => row.id).join(", ")}`,
      );
    }

    const writtenTenants = await tx
      .insert(tenants)
      .values(seed.tenant)
      .onConflictDoUpdate({
        target: tenants.id,
        set: { slug: sql`excluded.slug`, name: sql`excluded.name`, updatedAt: sql`now()` },
        setWhere: changed([tenants.slug, tenants.name]),
      })
      .returning({ id: tenants.id });

    const writtenProperties = seed.properties.length
      ? await tx
          .insert(properties)
          .values(
            seed.properties.map((property) => ({
              id: property.id,
              tenantId,
              slug: property.slug,
              displayName: property.displayName,
              spokenName: property.spokenName,
              locationName: property.locationName,
              timezone: property.timezone,
              isActive: property.isActive,
            })),
          )
          .onConflictDoUpdate({
            target: properties.id,
            set: {
              slug: sql`excluded.slug`,
              displayName: sql`excluded.display_name`,
              spokenName: sql`excluded.spoken_name`,
              locationName: sql`excluded.location_name`,
              timezone: sql`excluded.timezone`,
              isActive: sql`excluded.is_active`,
              updatedAt: sql`now()`,
            },
            setWhere: changed([
              properties.slug,
              properties.displayName,
              properties.spokenName,
              properties.locationName,
              properties.timezone,
              properties.isActive,
            ]),
          })
          .returning({ id: properties.id })
      : [];

    const writtenUnits = unitRows.length
      ? await tx
          .insert(units)
          .values(
            unitRows.map((unit) => ({
              id: unit.id,
              tenantId,
              propertyId: unit.propertyId,
              slug: unit.slug,
              displayName: unit.displayName,
              isActive: unit.isActive,
            })),
          )
          .onConflictDoUpdate({
            target: units.id,
            set: {
              propertyId: sql`excluded.property_id`,
              slug: sql`excluded.slug`,
              displayName: sql`excluded.display_name`,
              isActive: sql`excluded.is_active`,
              updatedAt: sql`now()`,
            },
            setWhere: changed([units.propertyId, units.slug, units.displayName, units.isActive]),
          })
          .returning({ id: units.id })
      : [];

    const mappingRows = EXTERNAL_PROVIDERS.flatMap((provider) => [
      ...seed.properties.map((property) => ({
        provider,
        entityType: "property" as const,
        internalEntityId: property.id,
        externalId: property.externalIds[provider],
      })),
      ...unitRows.map((unit) => ({
        provider,
        entityType: "unit" as const,
        internalEntityId: unit.id,
        externalId: unit.externalIds[provider],
      })),
    ]).flatMap(({ externalId, ...row }) =>
      externalId === undefined ? [] : [{ ...row, tenantId, externalId }],
    );

    const writtenMappings = mappingRows.length
      ? await tx
          .insert(externalMappings)
          .values(mappingRows)
          .onConflictDoUpdate({
            target: [
              externalMappings.tenantId,
              externalMappings.provider,
              externalMappings.entityType,
              externalMappings.internalEntityId,
            ],
            set: { externalId: sql`excluded.external_id`, updatedAt: sql`now()` },
            setWhere: changed([externalMappings.externalId]),
          })
          .returning({ id: externalMappings.id })
      : [];

    return {
      written: {
        tenants: writtenTenants.length,
        properties: writtenProperties.length,
        units: writtenUnits.length,
        externalMappings: writtenMappings.length,
      },
    };
  });
}
