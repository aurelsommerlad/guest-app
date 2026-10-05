// Server-only: never import @up/db into client components.
export {
  createDatabase,
  type Database,
  type DatabaseConnection,
  type DatabaseTarget,
  describeDatabaseUrl,
} from "./client";
export {
  ADMIN_USER_STATUSES,
  adminSessions,
  adminUsers,
  externalMappings,
  GUIDE_ENTRY_KINDS,
  guestAccess,
  guideSections,
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
  createGuideOverride,
  createGuideTopic,
  deleteUnpublishedGuideEntry,
  getGuideEntry,
  type GuideEntryRecord,
  listGuideEntriesForProperty,
  listPublishedGuideEntries,
  type NewGuideOverride,
  type NewGuideTopic,
  setGuideEntryStatus,
  setGuideTopicOrder,
  type TopicMetaUpdate,
  updateGuideContent,
  updateGuideTopicMeta,
} from "./repositories/guide-repository";
export {
  type AdminUser,
  type AdminUserWithHash,
  countAdminUsers,
  createAdminSession,
  createAdminUser,
  findAdminSessionByTokenHash,
  findAdminUserByEmail,
  normalizeAdminEmail,
  recordAdminLogin,
  revokeAdminSession,
} from "./repositories/admin-repository";
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
  listPropertiesForTenant,
  resolveExternalMapping,
} from "./repositories/tenancy-repository";
export { type TenantSeed, type TenantSeedInput, tenantSeedSchema } from "./seed/seed-data";
export { SeedConflictError, type SeedResult, seedTenant } from "./seed/seed-tenant";
export { guideFixtures, seedGuideFixtures } from "./seed/guide-fixtures";
export { previewFixturesSeed } from "./seed/preview-fixtures";
export { uniquePlacesSeed } from "./seed/unique-places";
