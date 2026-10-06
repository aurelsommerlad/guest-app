/**
 * Database schema: Tenant → Property → Unit and external id mappings (ADR 0010).
 *
 * Rules (ADR 0002):
 * - Primary keys are our own stable text ids (never PMS ids), format ENTITY_KEY_PATTERN.
 * - Every tenant-related table has `tenant_id NOT NULL`.
 * - Child rows reference parents via composite foreign keys `(tenant_id, id)`, so a row
 *   can never point to an entity of another tenant.
 * - Row Level Security is enabled on every table without policies: the Supabase Data API
 *   roles (`anon`, `authenticated`) see nothing. The app connects as the table owner.
 */
import {
  CONTENT_LOCALES,
  type ContentImage,
  ENTITY_KEY_PATTERN,
  EXPLORE_CATEGORIES,
  type ExploreCategory,
  EXTERNAL_ENTITY_TYPES,
  EXTERNAL_PROVIDERS,
  GUIDE_ICONS,
  DOCUMENT_TYPES,
  GUEST_COUNT_SOURCES,
  GUEST_ROLES,
  GUIDE_STATUSES,
  type GuideBlock,
  type GuideIcon,
  type LocalizedText,
  MAX_TRAVELLERS,
  type PropertyAccessConfig,
  type PropertyRegistrationConfig,
  REGISTRATION_FIELDS,
  REGISTRATION_STATUSES,
  REGISTRATION_TARGETS,
  RESERVATION_PROVIDERS,
  SYNC_ERROR_CODES,
  SYNC_STATUSES,
  type TranslationState,
  type Visibility,
} from "@up/core";
import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  integer,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const keyPattern = sql.raw(`'${ENTITY_KEY_PATTERN.source}'`);

function isKey(column: AnyPgColumn): SQL {
  return sql`${column} ~ ${keyPattern}`;
}

function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(", "))})`;
}

function notBlank(column: AnyPgColumn, maxLength: number): SQL {
  return sql`char_length(btrim(${column})) BETWEEN 1 AND ${sql.raw(String(maxLength))}`;
}

function isSha256Hex(column: AnyPgColumn): SQL {
  return sql`${column} ~ '^[0-9a-f]{64}$'`;
}

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const tenants = pgTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique("tenants_slug_key"),
    name: text("name").notNull(),
    ...timestamps,
  },
  (t) => [
    check("tenants_id_format", isKey(t.id)),
    check("tenants_slug_format", isKey(t.slug)),
    check("tenants_name_not_blank", notBlank(t.name, 200)),
  ],
).enableRLS();

export const properties = pgTable(
  "properties",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    spokenName: text("spoken_name").notNull(),
    locationName: text("location_name").notNull(),
    timezone: text("timezone").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("properties_tenant_id_id_key").on(t.tenantId, t.id),
    unique("properties_tenant_id_slug_key").on(t.tenantId, t.slug),
    check("properties_id_format", isKey(t.id)),
    check("properties_slug_format", isKey(t.slug)),
    check("properties_display_name_not_blank", notBlank(t.displayName, 100)),
    check("properties_spoken_name_not_blank", notBlank(t.spokenName, 100)),
    check("properties_location_name_not_blank", notBlank(t.locationName, 100)),
    check("properties_timezone_not_blank", notBlank(t.timezone, 64)),
  ],
).enableRLS();

export const units = pgTable(
  "units",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    propertyId: text("property_id").notNull(),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "units_property_fkey",
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete("restrict"),
    unique("units_tenant_id_id_key").on(t.tenantId, t.id),
    // Target for references that require "unit belongs to this property and tenant".
    unique("units_tenant_id_property_id_id_key").on(t.tenantId, t.propertyId, t.id),
    unique("units_property_id_slug_key").on(t.propertyId, t.slug),
    index("units_tenant_id_property_id_idx").on(t.tenantId, t.propertyId),
    check("units_id_format", isKey(t.id)),
    check("units_slug_format", isKey(t.slug)),
    check("units_display_name_not_blank", notBlank(t.displayName, 100)),
  ],
).enableRLS();

/**
 * Generic mapping of our entities to ids in external systems (Apaleo, later Nuki, …).
 *
 * `internal_entity_id` is polymorphic (by `entity_type`). The generated columns
 * `property_id` / `unit_id` give it real, tenant-consistent foreign keys: a mapping can
 * only point to an existing entity of the same tenant.
 */
export const externalMappings = pgTable(
  "external_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    provider: text("provider", { enum: EXTERNAL_PROVIDERS }).notNull(),
    entityType: text("entity_type", { enum: EXTERNAL_ENTITY_TYPES }).notNull(),
    internalEntityId: text("internal_entity_id").notNull(),
    externalId: text("external_id").notNull(),
    propertyId: text("property_id").generatedAlwaysAs(
      sql`CASE WHEN entity_type = 'property' THEN internal_entity_id END`,
    ),
    unitId: text("unit_id").generatedAlwaysAs(
      sql`CASE WHEN entity_type = 'unit' THEN internal_entity_id END`,
    ),
    ...timestamps,
  },
  (t) => [
    // One external id resolves to exactly one internal entity (per tenant, provider, type) …
    unique("external_mappings_external_key").on(t.tenantId, t.provider, t.entityType, t.externalId),
    // … and an internal entity has at most one id per provider.
    unique("external_mappings_internal_key").on(
      t.tenantId,
      t.provider,
      t.entityType,
      t.internalEntityId,
    ),
    foreignKey({
      name: "external_mappings_property_fkey",
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "external_mappings_unit_fkey",
      columns: [t.tenantId, t.unitId],
      foreignColumns: [units.tenantId, units.id],
    }).onDelete("restrict"),
    check("external_mappings_provider_valid", oneOf(t.provider, EXTERNAL_PROVIDERS)),
    check("external_mappings_entity_type_valid", oneOf(t.entityType, EXTERNAL_ENTITY_TYPES)),
    check("external_mappings_external_id_not_blank", notBlank(t.externalId, 255)),
  ],
).enableRLS();

/**
 * Guest access to one reservation (ADR 0011). Stores no personal data: the link to the
 * guest exists only via the reservation id in the PMS. The link token is stored only as
 * its SHA-256 hash.
 */
export const guestAccess = pgTable(
  "guest_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    propertyId: text("property_id").notNull(),
    /** Optional: units can be assigned late or change; STAY reads the live assignment. */
    unitId: text("unit_id"),
    reservationProvider: text("reservation_provider", { enum: RESERVATION_PROVIDERS }).notNull(),
    externalReservationId: text("external_reservation_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "guest_access_property_fkey",
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete("restrict"),
    // Unit (if set) must belong to the same property and tenant.
    foreignKey({
      name: "guest_access_unit_fkey",
      columns: [t.tenantId, t.propertyId, t.unitId],
      foreignColumns: [units.tenantId, units.propertyId, units.id],
    }).onDelete("restrict"),
    unique("guest_access_token_hash_key").on(t.tokenHash),
    unique("guest_access_tenant_id_id_key").on(t.tenantId, t.id),
    index("guest_access_reservation_idx").on(
      t.tenantId,
      t.reservationProvider,
      t.externalReservationId,
    ),
    check(
      "guest_access_reservation_provider_valid",
      oneOf(t.reservationProvider, RESERVATION_PROVIDERS),
    ),
    check("guest_access_external_reservation_id_not_blank", notBlank(t.externalReservationId, 255)),
    check("guest_access_token_hash_format", isSha256Hex(t.tokenHash)),
    check("guest_access_valid_range", sql`${t.validUntil} > ${t.validFrom}`),
  ],
).enableRLS();

/**
 * Server-side guest sessions. The cookie carries an opaque random secret; only its hash
 * is stored. Every request checks session *and* guest access, so revoking either ends
 * access immediately.
 */
export const guestSessions = pgTable(
  "guest_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    guestAccessId: uuid("guest_access_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "guest_sessions_guest_access_fkey",
      columns: [t.tenantId, t.guestAccessId],
      foreignColumns: [guestAccess.tenantId, guestAccess.id],
    }).onDelete("cascade"),
    unique("guest_sessions_token_hash_key").on(t.tokenHash),
    index("guest_sessions_guest_access_id_idx").on(t.guestAccessId),
    check("guest_sessions_token_hash_format", isSha256Hex(t.tokenHash)),
  ],
).enableRLS();

/**
 * Fixed-window counters for rate limiting public endpoints (guest login). Keys are
 * hashes ("<scope>:<sha256>") – no IP addresses or booking numbers in clear text.
 * Rows older than a day are pruned on use.
 */
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").primaryKey(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    hits: integer("hits").notNull(),
  },
  (t) => [
    index("rate_limit_buckets_window_started_at_idx").on(t.windowStartedAt),
    check("rate_limit_buckets_hits_positive", sql`${t.hits} > 0`),
    check("rate_limit_buckets_key_length", sql`char_length(${t.key}) BETWEEN 1 AND 128`),
  ],
).enableRLS();

export const GUIDE_ENTRY_KINDS = ["topic", "override"] as const;
export const SCOPE_LEVELS = ["tenant", "property", "unit"] as const;

/**
 * GUIDE content (ADR 0013): one row per topic or per apartment override.
 *
 * - topic:    title, slug, icon, order + default content; scope tenant | property | unit.
 * - override: content only (intro, hero image, blocks) for one unit; belongs to the topic
 *             with the same `key`. Metadata columns must be NULL.
 * Localised fields are jsonb `{ de, en }`. Blocks are a validated jsonb array – no HTML.
 * Only `published` rows are ever shown to guests; `archived` replaces deletion.
 */
export const guideSections = pgTable(
  "guide_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    kind: text("kind", { enum: GUIDE_ENTRY_KINDS }).notNull(),
    scopeLevel: text("scope_level", { enum: SCOPE_LEVELS }).notNull(),
    propertyId: text("property_id"),
    unitId: text("unit_id"),
    status: text("status", { enum: GUIDE_STATUSES }).notNull().default("draft"),
    sortOrder: integer("sort_order").notNull().default(0),
    icon: text("icon").$type<GuideIcon>(),
    slug: jsonb("slug").$type<LocalizedText>(),
    eyebrow: jsonb("eyebrow").$type<LocalizedText>(),
    title: jsonb("title").$type<LocalizedText>(),
    shortDescription: jsonb("short_description").$type<LocalizedText>(),
    visibility: jsonb("visibility").$type<Visibility>(),
    intro: jsonb("intro").$type<LocalizedText>(),
    heroImage: jsonb("hero_image").$type<ContentImage>(),
    blocks: jsonb("blocks").$type<GuideBlock[]>().notNull().default([]),
    sourceLocale: text("source_locale").notNull().default("de"),
    translationState: jsonb("translation_state").$type<TranslationState>().notNull().default({}),
    /** Set on the first publication – a published entry can only be archived, not deleted. */
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "guide_sections_tenant_fkey",
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "guide_sections_property_fkey",
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "guide_sections_unit_fkey",
      columns: [t.tenantId, t.propertyId, t.unitId],
      foreignColumns: [units.tenantId, units.propertyId, units.id],
    }).onDelete("restrict"),
    // One live topic per key and scope target, one live override per key and unit.
    uniqueIndex("guide_sections_live_key_idx")
      .on(
        t.tenantId,
        t.kind,
        sql`coalesce(${t.propertyId}, '')`,
        sql`coalesce(${t.unitId}, '')`,
        t.key,
      )
      .where(sql`${t.status} <> 'archived'`),
    index("guide_sections_tenant_property_idx").on(t.tenantId, t.propertyId),
    check("guide_sections_key_format", isKey(t.key)),
    check("guide_sections_kind_valid", oneOf(t.kind, GUIDE_ENTRY_KINDS)),
    check("guide_sections_scope_level_valid", oneOf(t.scopeLevel, SCOPE_LEVELS)),
    check("guide_sections_status_valid", oneOf(t.status, GUIDE_STATUSES)),
    check("guide_sections_source_locale_valid", oneOf(t.sourceLocale, CONTENT_LOCALES)),
    check(
      "guide_sections_scope_shape",
      sql`(${t.scopeLevel} = 'tenant' AND ${t.propertyId} IS NULL AND ${t.unitId} IS NULL)
        OR (${t.scopeLevel} = 'property' AND ${t.propertyId} IS NOT NULL AND ${t.unitId} IS NULL)
        OR (${t.scopeLevel} = 'unit' AND ${t.propertyId} IS NOT NULL AND ${t.unitId} IS NOT NULL)`,
    ),
    check(
      "guide_sections_topic_shape",
      sql`${t.kind} <> 'topic' OR (${t.title} IS NOT NULL AND ${t.slug} IS NOT NULL
        AND ${t.shortDescription} IS NOT NULL AND ${t.icon} IS NOT NULL)`,
    ),
    check(
      "guide_sections_override_shape",
      sql`${t.kind} <> 'override' OR (${t.scopeLevel} = 'unit' AND ${t.title} IS NULL
        AND ${t.slug} IS NULL AND ${t.shortDescription} IS NULL AND ${t.eyebrow} IS NULL
        AND ${t.icon} IS NULL AND ${t.visibility} IS NULL)`,
    ),
    check("guide_sections_icon_valid", sql`${t.icon} IS NULL OR ${oneOf(t.icon, GUIDE_ICONS)}`),
    check("guide_sections_blocks_array", sql`jsonb_typeof(${t.blocks}) = 'array'`),
  ],
).enableRLS();

/** Optional http(s) link column. */
function isHttpUrl(column: AnyPgColumn): SQL {
  return sql`${column} IS NULL OR (${column} ~ '^https?://' AND char_length(${column}) <= 2000)`;
}

/**
 * EXPLORE places (ADR 0015): recommendations of one tenant. Which properties a place is
 * recommended for lives in explore_place_properties – a place without assignment is shown
 * nowhere. Same status lifecycle and translation state as GUIDE.
 */
export const explorePlaces = pgTable(
  "explore_places",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    status: text("status", { enum: GUIDE_STATUSES }).notNull().default("draft"),
    category: text("category").$type<ExploreCategory>().notNull(),
    slug: jsonb("slug").$type<LocalizedText>().notNull(),
    title: jsonb("title").$type<LocalizedText>().notNull(),
    teaser: jsonb("teaser").$type<LocalizedText>().notNull(),
    description: jsonb("description").$type<LocalizedText>(),
    tip: jsonb("tip").$type<LocalizedText>(),
    openingHours: jsonb("opening_hours").$type<LocalizedText>(),
    heroImage: jsonb("hero_image").$type<ContentImage>(),
    address: text("address"),
    locality: text("locality"),
    mapsUrl: text("maps_url"),
    websiteUrl: text("website_url"),
    phone: text("phone"),
    reservationUrl: text("reservation_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    featured: boolean("featured").notNull().default(false),
    sourceLocale: text("source_locale").notNull().default("de"),
    translationState: jsonb("translation_state").$type<TranslationState>().notNull().default({}),
    /** Set on the first publication – a published place can only be archived, not deleted. */
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("explore_places_tenant_id_id_key").on(t.tenantId, t.id),
    index("explore_places_tenant_status_idx").on(t.tenantId, t.status),
    check("explore_places_status_valid", oneOf(t.status, GUIDE_STATUSES)),
    check("explore_places_category_valid", oneOf(t.category, EXPLORE_CATEGORIES)),
    check("explore_places_source_locale_valid", oneOf(t.sourceLocale, CONTENT_LOCALES)),
    check(
      "explore_places_texts_present",
      sql`jsonb_typeof(${t.title}) = 'object' AND ${t.title} ? 'de'
        AND jsonb_typeof(${t.teaser}) = 'object' AND ${t.teaser} ? 'de'
        AND jsonb_typeof(${t.slug}) = 'object' AND ${t.slug} ? 'de'`,
    ),
    check("explore_places_maps_url_valid", isHttpUrl(t.mapsUrl)),
    check("explore_places_website_url_valid", isHttpUrl(t.websiteUrl)),
    check("explore_places_reservation_url_valid", isHttpUrl(t.reservationUrl)),
    check(
      "explore_places_phone_valid",
      sql`${t.phone} IS NULL OR ${t.phone} ~ '^\\+?[0-9][0-9 ()/-]{2,38}$'`,
    ),
    check(
      "explore_places_address_length",
      sql`(${t.address} IS NULL OR char_length(${t.address}) <= 300)
        AND (${t.locality} IS NULL OR char_length(${t.locality}) <= 80)`,
    ),
  ],
).enableRLS();

/**
 * Which properties a place is recommended for. Both foreign keys include the tenant, so a
 * place can never be assigned to a property of another tenant.
 */
export const explorePlaceProperties = pgTable(
  "explore_place_properties",
  {
    tenantId: text("tenant_id").notNull(),
    placeId: uuid("place_id").notNull(),
    propertyId: text("property_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "explore_place_properties_pkey", columns: [t.placeId, t.propertyId] }),
    foreignKey({
      name: "explore_place_properties_place_fkey",
      columns: [t.tenantId, t.placeId],
      foreignColumns: [explorePlaces.tenantId, explorePlaces.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "explore_place_properties_property_fkey",
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete("restrict"),
    index("explore_place_properties_property_idx").on(t.tenantId, t.propertyId),
  ],
).enableRLS();

/**
 * Guest journey settings per property (ADR 0016/0017): online check-in configuration and
 * access settings – two separate documents, validated by @up/core schemas on write and read.
 * A property without a row has online check-in switched off and manual access.
 */
export const propertyJourneySettings = pgTable(
  "property_journey_settings",
  {
    tenantId: text("tenant_id").notNull(),
    propertyId: text("property_id").notNull(),
    registration: jsonb("registration").$type<PropertyRegistrationConfig>().notNull(),
    access: jsonb("access").$type<PropertyAccessConfig>().notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "property_journey_settings_pkey", columns: [t.tenantId, t.propertyId] }),
    foreignKey({
      name: "property_journey_settings_property_fkey",
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete("cascade"),
    check(
      "property_journey_settings_documents_are_objects",
      sql`jsonb_typeof(${t.registration}) = 'object' AND jsonb_typeof(${t.access}) = 'object'`,
    ),
  ],
).enableRLS();

/**
 * Canonical online check-in of one reservation (ADR 0016) – the single source of guest
 * registration data. Provider-neutral; targets receive copies via guest_registration_syncs.
 */
export const guestRegistrations = pgTable(
  "guest_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    propertyId: text("property_id").notNull(),
    reservationProvider: text("reservation_provider", { enum: RESERVATION_PROVIDERS }).notNull(),
    externalReservationId: text("external_reservation_id").notNull(),
    status: text("status", { enum: REGISTRATION_STATUSES }).notNull().default("draft"),
    guestCount: integer("guest_count").notNull(),
    guestCountSource: text("guest_count_source", { enum: GUEST_COUNT_SOURCES }).notNull(),
    /** Stay window as known when the registration was last written (for syncs and retention). */
    arrivalAt: timestamp("arrival_at", { withTimezone: true }).notNull(),
    departureAt: timestamp("departure_at", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** Personal data may be deleted from this instant (null: retention not configured). */
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    /** Set when the personal data (guest rows) was deleted. */
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    /**
     * Set when the reservation's occupancy changed the guest count of a draft; the guest
     * sees a notice until the next save. Occupancy (PMS) and person slots stay separate.
     */
    guestCountChangedAt: timestamp("guest_count_changed_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "guest_registrations_property_fkey",
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete("restrict"),
    unique("guest_registrations_tenant_id_id_key").on(t.tenantId, t.id),
    // Exactly one registration per reservation.
    unique("guest_registrations_reservation_key").on(
      t.tenantId,
      t.reservationProvider,
      t.externalReservationId,
    ),
    index("guest_registrations_purge_after_idx").on(t.purgeAfter),
    check("guest_registrations_status_valid", oneOf(t.status, REGISTRATION_STATUSES)),
    check(
      "guest_registrations_reservation_provider_valid",
      oneOf(t.reservationProvider, RESERVATION_PROVIDERS),
    ),
    check(
      "guest_registrations_guest_count_source_valid",
      oneOf(t.guestCountSource, GUEST_COUNT_SOURCES),
    ),
    check(
      "guest_registrations_external_reservation_id_not_blank",
      notBlank(t.externalReservationId, 255),
    ),
    check(
      "guest_registrations_guest_count_range",
      sql`${t.guestCount} BETWEEN 1 AND ${sql.raw(String(MAX_TRAVELLERS))}`,
    ),
    check("guest_registrations_stay_range", sql`${t.departureAt} > ${t.arrivalAt}`),
    check(
      "guest_registrations_submitted_consistent",
      sql`(${t.status} = 'submitted') = (${t.submittedAt} IS NOT NULL)`,
    ),
    check("guest_registrations_version_positive", sql`${t.version} > 0`),
  ],
).enableRLS();

function maxLength(column: AnyPgColumn, length: number): SQL {
  return sql`${column} IS NULL OR char_length(${column}) BETWEEN 1 AND ${sql.raw(String(length))}`;
}

/**
 * Travellers of a registration: position 0 is the primary guest. Only configured fields
 * are filled; everything else stays NULL (data minimisation).
 */
export const guestRegistrationGuests = pgTable(
  "guest_registration_guests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    registrationId: uuid("registration_id").notNull(),
    position: integer("position").notNull(),
    role: text("role", { enum: GUEST_ROLES }).notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    /** Main guest only: a directly reachable address (channel relays are refused). */
    email: text("email"),
    /** Mobile number of every traveller, E.164. */
    phone: text("phone"),
    birthDate: date("birth_date", { mode: "string" }),
    nationality: text("nationality"),
    street: text("street"),
    postalCode: text("postal_code"),
    city: text("city"),
    country: text("country"),
    documentType: text("document_type", { enum: DOCUMENT_TYPES }),
    documentNumber: text("document_number"),
    /** Fields whose value came from the PMS and was not changed by the guest (provenance). */
    prefilledFields: text("prefilled_fields")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "guest_registration_guests_registration_fkey",
      columns: [t.tenantId, t.registrationId],
      foreignColumns: [guestRegistrations.tenantId, guestRegistrations.id],
    }).onDelete("cascade"),
    unique("guest_registration_guests_position_key").on(t.registrationId, t.position),
    check(
      "guest_registration_guests_position_range",
      sql`${t.position} BETWEEN 0 AND ${sql.raw(String(MAX_TRAVELLERS - 1))}`,
    ),
    check(
      "guest_registration_guests_role_matches_position",
      sql`(${t.position} = 0) = (${t.role} = 'primary')`,
    ),
    check("guest_registration_guests_role_valid", oneOf(t.role, GUEST_ROLES)),
    check(
      "guest_registration_guests_document_type_valid",
      sql`${t.documentType} IS NULL OR ${oneOf(t.documentType, DOCUMENT_TYPES)}`,
    ),
    check(
      "guest_registration_guests_country_codes",
      sql`(${t.nationality} IS NULL OR ${t.nationality} ~ '^[A-Z]{2}$')
        AND (${t.country} IS NULL OR ${t.country} ~ '^[A-Z]{2}$')`,
    ),
    check(
      "guest_registration_guests_email_valid",
      sql`${t.email} IS NULL OR (${t.email} = lower(${t.email})
        AND char_length(${t.email}) BETWEEN 3 AND 254 AND position('@' in ${t.email}) > 1
        AND ${t.email} !~ '@([a-z0-9-]+\\.)*guest\\.booking\\.com$')`,
    ),
    check(
      "guest_registration_guests_phone_e164",
      sql`${t.phone} IS NULL OR ${t.phone} ~ '^\\+[1-9][0-9]{6,14}$'`,
    ),
    check(
      "guest_registration_guests_prefilled_fields_known",
      sql`${t.prefilledFields} <@ ARRAY[${sql.raw(REGISTRATION_FIELDS.map((field) => `'${field}'`).join(", "))}]::text[]`,
    ),
    check(
      "guest_registration_guests_text_lengths",
      sql`(${maxLength(t.firstName, 100)}) AND (${maxLength(t.lastName, 100)})
        AND (${maxLength(t.street, 200)}) AND (${maxLength(t.postalCode, 12)})
        AND (${maxLength(t.city, 100)}) AND (${maxLength(t.documentNumber, 40)})`,
    ),
  ],
).enableRLS();

/**
 * One row per registration and target (Apaleo, Feratel …): persistent, idempotent sync
 * state. Stores codes and references only – never provider responses or guest data.
 */
export const guestRegistrationSyncs = pgTable(
  "guest_registration_syncs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    registrationId: uuid("registration_id").notNull(),
    provider: text("provider", { enum: REGISTRATION_TARGETS }).notNull(),
    status: text("status", { enum: SYNC_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code", { enum: SYNC_ERROR_CODES }),
    externalReference: text("external_reference"),
    /** SHA-256 of what was last written – detects "already written" without storing data. */
    fingerprint: text("fingerprint"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "guest_registration_syncs_registration_fkey",
      columns: [t.tenantId, t.registrationId],
      foreignColumns: [guestRegistrations.tenantId, guestRegistrations.id],
    }).onDelete("cascade"),
    // Idempotency: one sync per registration and target, however often "submit" arrives.
    unique("guest_registration_syncs_target_key").on(t.registrationId, t.provider),
    index("guest_registration_syncs_due_idx").on(t.status, t.nextAttemptAt),
    check("guest_registration_syncs_provider_valid", oneOf(t.provider, REGISTRATION_TARGETS)),
    check("guest_registration_syncs_status_valid", oneOf(t.status, SYNC_STATUSES)),
    check(
      "guest_registration_syncs_error_code_valid",
      sql`${t.lastErrorCode} IS NULL OR ${oneOf(t.lastErrorCode, SYNC_ERROR_CODES)}`,
    ),
    check("guest_registration_syncs_attempts_range", sql`${t.attempts} >= 0`),
    check(
      "guest_registration_syncs_fingerprint_format",
      sql`${t.fingerprint} IS NULL OR ${isSha256Hex(t.fingerprint)}`,
    ),
    check(
      "guest_registration_syncs_external_reference_length",
      maxLength(t.externalReference, 255),
    ),
  ],
).enableRLS();

/**
 * Key box code per unit (ADR 0017): one encrypted value per unit – never per reservation,
 * never in clear text. AES-256-GCM, bound to tenant/property/unit (@up/core).
 */
export const unitAccessCodes = pgTable(
  "unit_access_codes",
  {
    tenantId: text("tenant_id").notNull(),
    propertyId: text("property_id").notNull(),
    unitId: text("unit_id").notNull(),
    codeCiphertext: text("code_ciphertext").notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "unit_access_codes_pkey", columns: [t.tenantId, t.propertyId, t.unitId] }),
    foreignKey({
      name: "unit_access_codes_unit_fkey",
      columns: [t.tenantId, t.propertyId, t.unitId],
      foreignColumns: [units.tenantId, units.propertyId, units.id],
    }).onDelete("cascade"),
    check(
      "unit_access_codes_ciphertext_format",
      sql`${t.codeCiphertext} ~ '^v1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$'`,
    ),
  ],
).enableRLS();

export const ADMIN_USER_STATUSES = ["active", "disabled"] as const;

/**
 * Admin accounts (ADR 0014). One account belongs to exactly one tenant; e-mail is the
 * login name (stored lowercased, globally unique). Passwords only as scrypt hashes.
 * MFA can be added later as separate factor data without changing this table's role.
 */
export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    displayName: text("display_name"),
    passwordHash: text("password_hash").notNull(),
    status: text("status", { enum: ADMIN_USER_STATUSES }).notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("admin_users_email_key").on(t.email),
    unique("admin_users_tenant_id_id_key").on(t.tenantId, t.id),
    check(
      "admin_users_email_format",
      sql`${t.email} = lower(${t.email}) AND char_length(${t.email}) BETWEEN 3 AND 254 AND position('@' in ${t.email}) > 1`,
    ),
    check("admin_users_password_hash_format", sql`${t.passwordHash} LIKE 'scrypt$%'`),
    check("admin_users_status_valid", oneOf(t.status, ADMIN_USER_STATUSES)),
  ],
).enableRLS();

/** Server-side admin sessions: opaque secret in the cookie, only its hash stored. */
export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    adminUserId: uuid("admin_user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "admin_sessions_admin_user_fkey",
      columns: [t.tenantId, t.adminUserId],
      foreignColumns: [adminUsers.tenantId, adminUsers.id],
    }).onDelete("cascade"),
    unique("admin_sessions_token_hash_key").on(t.tokenHash),
    index("admin_sessions_admin_user_id_idx").on(t.adminUserId),
    check("admin_sessions_token_hash_format", isSha256Hex(t.tokenHash)),
  ],
).enableRLS();

export const schema = {
  tenants,
  properties,
  units,
  externalMappings,
  guestAccess,
  guestSessions,
  rateLimitBuckets,
  guideSections,
  adminUsers,
  adminSessions,
  explorePlaces,
  explorePlaceProperties,
  propertyJourneySettings,
  guestRegistrations,
  guestRegistrationGuests,
  guestRegistrationSyncs,
  unitAccessCodes,
};
