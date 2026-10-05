// Server-only: never import @up/db into client components.
export {
  createDatabase,
  type Database,
  type DatabaseConnection,
  type DatabaseTarget,
  describeDatabaseUrl,
} from "./client";
export { externalMappings, properties, schema, tenants, units } from "./schema";
export {
  type ExternalReference,
  getPropertyById,
  getPropertyBySlug,
  getTenantBySlug,
  getUnitsForProperty,
  resolveExternalMapping,
} from "./repositories/tenancy-repository";
export { type TenantSeed, type TenantSeedInput, tenantSeedSchema } from "./seed/seed-data";
export { SeedConflictError, type SeedResult, seedTenant } from "./seed/seed-tenant";
export { uniquePlacesSeed } from "./seed/unique-places";
