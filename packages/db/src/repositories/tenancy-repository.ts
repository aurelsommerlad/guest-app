/**
 * Tenant-scoped reads for Tenant → Property → Unit and external mappings.
 *
 * Every function except `getTenantBySlug` (which is how a tenant context is obtained)
 * requires a TenantContext and filters by `tenant_id` in SQL. Unknown or malformed ids
 * return `undefined` / `[]` – never data of another tenant.
 */
import {
  type ExternalEntityType,
  type ExternalProvider,
  isEntityKey,
  isExternalEntityType,
  isExternalProvider,
  type Property,
  type Tenant,
  type TenantContext,
  type Unit,
} from "@up/core";
import { and, asc, eq } from "drizzle-orm";

import { type Database } from "../client";
import { externalMappings, properties, tenants, units } from "../schema";

const tenantColumns = { id: tenants.id, slug: tenants.slug, name: tenants.name };

const propertyColumns = {
  id: properties.id,
  tenantId: properties.tenantId,
  slug: properties.slug,
  displayName: properties.displayName,
  spokenName: properties.spokenName,
  locationName: properties.locationName,
  timezone: properties.timezone,
  isActive: properties.isActive,
};

const unitColumns = {
  id: units.id,
  tenantId: units.tenantId,
  propertyId: units.propertyId,
  slug: units.slug,
  displayName: units.displayName,
  isActive: units.isActive,
};

function assertTenantContext(context: TenantContext): void {
  if (!isEntityKey(context.tenantId)) {
    throw new TypeError("Invalid tenant context");
  }
}

export async function getTenantBySlug(db: Database, slug: string): Promise<Tenant | undefined> {
  if (!isEntityKey(slug)) return undefined;
  const [tenant] = await db.select(tenantColumns).from(tenants).where(eq(tenants.slug, slug));
  return tenant;
}

export async function getPropertyById(
  db: Database,
  context: TenantContext,
  propertyId: string,
): Promise<Property | undefined> {
  assertTenantContext(context);
  if (!isEntityKey(propertyId)) return undefined;
  const [property] = await db
    .select(propertyColumns)
    .from(properties)
    .where(and(eq(properties.tenantId, context.tenantId), eq(properties.id, propertyId)));
  return property;
}

export async function getPropertyBySlug(
  db: Database,
  context: TenantContext,
  slug: string,
): Promise<Property | undefined> {
  assertTenantContext(context);
  if (!isEntityKey(slug)) return undefined;
  const [property] = await db
    .select(propertyColumns)
    .from(properties)
    .where(and(eq(properties.tenantId, context.tenantId), eq(properties.slug, slug)));
  return property;
}

/** Units of a property, ordered by slug. Inactive units only on request. */
export async function getUnitsForProperty(
  db: Database,
  context: TenantContext,
  propertyId: string,
  options: { includeInactive?: boolean } = {},
): Promise<Unit[]> {
  assertTenantContext(context);
  if (!isEntityKey(propertyId)) return [];
  return db
    .select(unitColumns)
    .from(units)
    .where(
      and(
        eq(units.tenantId, context.tenantId),
        eq(units.propertyId, propertyId),
        options.includeInactive ? undefined : eq(units.isActive, true),
      ),
    )
    .orderBy(asc(units.slug));
}

export type ExternalReference = {
  provider: ExternalProvider;
  entityType: ExternalEntityType;
  externalId: string;
};

/**
 * Resolves an external id (e.g. Apaleo unit "ALTUS-SWA") to our internal entity id
 * ("ros") within the tenant. Exact, case-sensitive match – never by name.
 */
export async function resolveExternalMapping(
  db: Database,
  context: TenantContext,
  reference: ExternalReference,
): Promise<string | undefined> {
  assertTenantContext(context);
  // Runtime guard: callers may pass values from webhooks or config.
  if (!isExternalProvider(reference.provider)) {
    throw new TypeError("Unsupported external provider");
  }
  if (!isExternalEntityType(reference.entityType)) {
    throw new TypeError("Unsupported external entity type");
  }
  if (reference.externalId.length === 0 || reference.externalId.length > 255) return undefined;
  const [mapping] = await db
    .select({ internalEntityId: externalMappings.internalEntityId })
    .from(externalMappings)
    .where(
      and(
        eq(externalMappings.tenantId, context.tenantId),
        eq(externalMappings.provider, reference.provider),
        eq(externalMappings.entityType, reference.entityType),
        eq(externalMappings.externalId, reference.externalId),
      ),
    );
  return mapping?.internalEntityId;
}
