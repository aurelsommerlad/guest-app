// Server-only: never import @up/db into client components.
export {
  createDatabase,
  type Database,
  type DatabaseConnection,
  type DatabaseTarget,
  describeDatabaseUrl,
} from "./client";
export {
  externalMappings,
  guestAccess,
  guestSessions,
  properties,
  rateLimitBuckets,
  schema,
  tenants,
  units,
} from "./schema";
export {
  createGuestAccess,
  createGuestSession,
  findGuestAccessByTokenHash,
  findGuestAccessForReservation,
  findGuestSessionByTokenHash,
  type GuestSessionRecord,
  markGuestAccessUsed,
  type NewGuestAccess,
  revokeGuestAccessForReservation,
  revokeGuestSession,
} from "./repositories/guest-access-repository";
export { hitRateLimit } from "./repositories/rate-limit-repository";
export {
  assertTarget as assertDatabaseTarget,
  CliUsageError,
  type CliOptions as DatabaseCliOptions,
  DB_TARGETS,
  type DbTarget,
  parseCliOptions as parseDatabaseCliOptions,
} from "./cli/target-guard";
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
export { previewFixturesSeed } from "./seed/preview-fixtures";
export { uniquePlacesSeed } from "./seed/unique-places";
