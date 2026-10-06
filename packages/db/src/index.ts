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
  explorePlaceProperties,
  explorePlaces,
  externalMappings,
  GUIDE_ENTRY_KINDS,
  guestAccess,
  guideSections,
  guestRegistrationGuests,
  guestRegistrations,
  guestRegistrationSyncs,
  guestSessions,
  properties,
  propertyJourneySettings,
  rateLimitBuckets,
  schema,
  tenants,
  unitAccessCodes,
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
export { exploreFixtures, seedExploreFixtures } from "./seed/explore-fixtures";
export {
  SAMPLE_KEYBOX_CODE,
  sampleAccessConfig,
  sampleRegistrationConfig,
  seedJourneyFixtures,
} from "./seed/journey-fixtures";
export {
  createExplorePlace,
  deleteUnpublishedExplorePlace,
  ExploreAssignmentError,
  type ExplorePlaceFields,
  type ExplorePlaceRecord,
  getExplorePlace,
  listExplorePlaces,
  listPublishedExplorePlaces,
  setExplorePlaceOrder,
  setExplorePlaceStatus,
  updateExplorePlace,
} from "./repositories/explore-repository";
export { previewFixturesSeed } from "./seed/preview-fixtures";
export { uniquePlacesSeed } from "./seed/unique-places";
export {
  deleteUnitAccessCode,
  getJourneySettings,
  getUnitAccessCode,
  type JourneySettings,
  JourneySettingsError,
  saveJourneySettings,
  setUnitAccessCode,
  type UnitKey,
} from "./repositories/journey-repository";
export {
  claimDueSyncs,
  completeSyncAttempt,
  getRegistrationById,
  getRegistrationForReservation,
  type GuestRegistrationRecord,
  listRegistrationSyncs,
  purgeExpiredRegistrationData,
  type RegistrationSyncRecord,
  type ReservationKey,
  saveRegistrationGuests,
  seedRegistrationGuests,
  startRegistration,
  type StartRegistrationInput,
  submitRegistration,
  type SubmitResult,
  syncRegistrationOccupancy,
  type WriteResult,
} from "./repositories/registration-repository";
