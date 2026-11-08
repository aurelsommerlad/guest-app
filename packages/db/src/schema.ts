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
  ADDRESS_STATUSES,
  BILLING_KINDS,
  type CancellationPolicy,
  type CommissionModel,
  FULFILLMENT_TYPES,
  OFFER_CATEGORIES,
  OFFER_KINDS,
  OFFER_PLACEMENTS,
  type OfferAvailability,
  type OfferPrice,
  CONTACT_VERIFICATION_EVENTS,
  OTP_CHALLENGE_STATUSES,
  OTP_CHANNELS,
  VERIFICATION_ACTORS,
  VERIFICATION_DELIVERIES,
  WAIVER_REASONS,
  BINDING_REGISTRATION_RULES,
  CONTENT_LOCALES,
  CREATING_OPERATIONS,
  GUEST_CARD_STATUSES,
  MANUAL_REASONS,
  OFFICIAL_ENVIRONMENTS,
  OFFICIAL_ERROR_CODES,
  OFFICIAL_OPERATIONS,
  OFFICIAL_REGISTRATION_TARGETS,
  REMOTE_STAGES,
  TRANSMISSION_STATUSES,
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
  ADMIN_ROLES,
  BOOKING_RULES,
  PROPERTY_SCOPES,
  SERVICE_ACTION_TYPES,
} from "@up/core";
import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
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

/* ------------------------------------------------------------------------------------------
 * Upselling: "Services & Erlebnisse" (concept docs/concepts/upselling-plattform.md, Phase 1)
 * ---------------------------------------------------------------------------------------- */

const commissionShape = (column: AnyPgColumn) =>
  sql`coalesce((${column}->>'type' = 'none')
    OR (${column}->>'type' = 'percent' AND (${column}->>'basisPoints')::int BETWEEN 1 AND 5000)
    OR (${column}->>'type' = 'fixed' AND (${column}->>'amountCents')::int > 0
      AND ${column}->>'currency' ~ '^[A-Z]{3}$'), false)`;

/**
 * Local partners (restaurants, activities …). Optionally the EXPLORE place they are, so
 * address and map are maintained once. Business contacts only – no guest data.
 */
export const partners = pgTable(
  "partners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    status: text("status", { enum: ["active", "inactive"] })
      .notNull()
      .default("active"),
    explorePlaceId: uuid("explore_place_id"),
    websiteUrl: text("website_url"),
    /** Default commission of the partner's offers. */
    commission: jsonb("commission").$type<CommissionModel>().notNull().default({ type: "none" }),
    ...timestamps,
  },
  (t) => [
    unique("partners_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "partners_explore_place_fkey",
      columns: [t.tenantId, t.explorePlaceId],
      foreignColumns: [explorePlaces.tenantId, explorePlaces.id],
    }).onDelete("set null"),
    check("partners_status_valid", sql`${t.status} IN ('active', 'inactive')`),
    check(
      "partners_name_length",
      sql`char_length(${t.name}) BETWEEN 2 AND 120 AND ${t.name} !~ '[<>]'`,
    ),
    check("partners_website_url_valid", isHttpUrl(t.websiteUrl)),
    check("partners_commission_valid", commissionShape(t.commission)),
  ],
).enableRLS();

/**
 * One catalog for own services and partner offers. Own services keep only the editorial
 * presentation here – price, availability and booking come from the Extras catalog (the
 * only service writing to Apaleo), referenced per property in `offer_properties`.
 */
export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: OFFER_KINDS }).notNull(),
    partnerId: uuid("partner_id"),
    category: text("category", { enum: OFFER_CATEGORIES }).notNull(),
    status: text("status", { enum: GUIDE_STATUSES }).notNull().default("draft"),
    slug: jsonb("slug").$type<LocalizedText>().notNull(),
    title: jsonb("title").$type<LocalizedText>().notNull(),
    teaser: jsonb("teaser").$type<LocalizedText>().notNull(),
    body: jsonb("body").$type<LocalizedText>(),
    details: jsonb("details").$type<LocalizedText>(),
    heroImage: jsonb("hero_image").$type<ContentImage>(),
    gallery: jsonb("gallery").$type<ContentImage[]>().notNull().default([]),
    fulfillment: text("fulfillment", { enum: FULFILLMENT_TYPES }).notNull(),
    bookingUrl: text("booking_url"),
    price: jsonb("price").$type<OfferPrice>(),
    durationMinutes: integer("duration_minutes"),
    cancellation: jsonb("cancellation").$type<CancellationPolicy>().notNull(),
    commission: jsonb("commission").$type<CommissionModel>(),
    availability: jsonb("availability").$type<OfferAvailability>().notNull(),
    featured: boolean("featured").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    sourceLocale: text("source_locale").notNull().default("de"),
    translationState: jsonb("translation_state").$type<TranslationState>().notNull().default({}),
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
    /** Import bookkeeping: "extras:<service code>" for offers created from the Extras catalog. */
    legacyKey: text("legacy_key"),
    ...timestamps,
  },
  (t) => [
    unique("offers_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("offers_legacy_key_idx").on(t.tenantId, t.legacyKey),
    check(
      "offers_legacy_key_valid",
      sql`${t.legacyKey} IS NULL OR ${t.legacyKey} ~ '^extras:[A-Za-z0-9_-]{1,120}$'`,
    ),
    index("offers_tenant_status_idx").on(t.tenantId, t.status),
    foreignKey({
      name: "offers_partner_fkey",
      columns: [t.tenantId, t.partnerId],
      foreignColumns: [partners.tenantId, partners.id],
    }).onDelete("restrict"),
    check("offers_kind_valid", oneOf(t.kind, OFFER_KINDS)),
    check("offers_category_valid", oneOf(t.category, OFFER_CATEGORIES)),
    check("offers_status_valid", oneOf(t.status, GUIDE_STATUSES)),
    check("offers_fulfillment_valid", oneOf(t.fulfillment, FULFILLMENT_TYPES)),
    check("offers_source_locale_valid", oneOf(t.sourceLocale, CONTENT_LOCALES)),
    check(
      "offers_kind_shape",
      sql`(${t.kind} = 'partner' AND ${t.partnerId} IS NOT NULL AND ${t.price} IS NOT NULL
          AND ${t.fulfillment} IN ('request', 'link'))
        OR (${t.kind} = 'house-service' AND ${t.partnerId} IS NULL AND ${t.price} IS NULL
          AND ${t.commission} IS NULL AND ${t.bookingUrl} IS NULL AND ${t.fulfillment} IN ('instant', 'request'))`,
    ),
    check("offers_link_has_url", sql`${t.fulfillment} <> 'link' OR ${t.bookingUrl} IS NOT NULL`),
    check("offers_booking_url_valid", isHttpUrl(t.bookingUrl)),
    check(
      "offers_texts_present",
      sql`jsonb_typeof(${t.title}) = 'object' AND ${t.title} ? 'de'
        AND jsonb_typeof(${t.teaser}) = 'object' AND ${t.teaser} ? 'de'
        AND jsonb_typeof(${t.slug}) = 'object' AND ${t.slug} ? 'de'`,
    ),
    check(
      "offers_price_valid",
      sql`coalesce(${t.price} IS NULL OR ${t.price}->>'model' = 'on-request'
        OR (${t.price}->>'model' IN ('fixed', 'from', 'per-person')
          AND (${t.price}->>'amountCents')::int >= 0 AND ${t.price}->>'currency' ~ '^[A-Z]{3}$'), false)`,
    ),
    check(
      "offers_cancellation_valid",
      sql`coalesce(${t.cancellation}->>'type' IN ('non-refundable', 'on-request', 'partner-terms')
        OR (${t.cancellation}->>'type' = 'free-until' AND (${t.cancellation}->>'hoursBefore')::int BETWEEN 0 AND 720), false)`,
    ),
    check(
      "offers_commission_valid",
      sql`${t.commission} IS NULL OR ${commissionShape(t.commission)}`,
    ),
    check(
      "offers_duration_valid",
      sql`${t.durationMinutes} IS NULL OR ${t.durationMinutes} BETWEEN 5 AND 20160`,
    ),
    check(
      "offers_gallery_valid",
      sql`jsonb_typeof(${t.gallery}) = 'array' AND jsonb_array_length(${t.gallery}) <= 8`,
    ),
  ],
).enableRLS();

/** Which properties an offer is shown for; own services carry the Extras reference per property. */
export const offerProperties = pgTable(
  "offer_properties",
  {
    tenantId: text("tenant_id").notNull(),
    offerId: uuid("offer_id").notNull(),
    propertyId: text("property_id").notNull(),
    /**
     * Apaleo service id of this property (own services). Historic name from Phase 1, when the
     * Extras app owned the configuration; since M1 the property configuration lives here.
     */
    extrasServiceId: text("extras_service_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    /* ── Property configuration (M1; Extras catalog fields, see docs/concepts/extras-migration.md) */
    /** Shown to guests of this property ("Im Gäste-Portal anzeigen"). */
    active: boolean("active").notNull().default(true),
    /** Own services: book an Apaleo service or amend the adults (additional guest). */
    actionType: text("action_type", { enum: SERVICE_ACTION_TYPES }),
    /** Own services: which Apaleo service dates are booked. */
    bookingRule: text("booking_rule", { enum: BOOKING_RULES }),
    /** Booking mode for this property; null = the offer's default. */
    fulfillment: text("fulfillment", { enum: FULFILLMENT_TYPES }),
    /** Additional guest: surcharge per person and night (cents). */
    extraPersonPriceCents: integer("extra_person_price_cents"),
    currency: text("currency"),
    /** Price unit label override (de/en); empty = default of the booking rule. */
    priceUnitLabel: jsonb("price_unit_label").$type<LocalizedText>(),
    requiresRemainingCapacity: boolean("requires_remaining_capacity").notNull().default(false),
    requiresVehicleRegistration: boolean("requires_vehicle_registration").notNull().default(false),
    maxOnePerReservation: boolean("max_one_per_reservation").notNull().default(false),
    /** Apaleo unit group ids; empty = every apartment type. */
    allowedUnitGroupIds: text("allowed_unit_group_ids").array().notNull().default([]),
    /** Per-property text overrides (null = the offer's texts). */
    titleOverride: jsonb("title_override").$type<LocalizedText>(),
    teaserOverride: jsonb("teaser_override").$type<LocalizedText>(),
    bodyOverride: jsonb("body_override").$type<LocalizedText>(),
    heroImageOverride: jsonb("hero_image_override").$type<ContentImage>(),
    /** Partner offers: price and availability for this property (null = the offer's). */
    priceOverride: jsonb("price_override").$type<OfferPrice>(),
    availabilityOverride: jsonb("availability_override").$type<OfferAvailability>(),
    /** Import bookkeeping: "<apaleoPropertyId>:<apaleoServiceId>" and hash of the last import. */
    legacyKey: text("legacy_key"),
    importedHash: text("imported_hash"),
    importedAt: timestamp("imported_at", { withTimezone: true }),
    updatedBy: uuid("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ name: "offer_properties_pkey", columns: [t.offerId, t.propertyId] }),
    foreignKey({
      name: "offer_properties_offer_fkey",
      columns: [t.tenantId, t.offerId],
      foreignColumns: [offers.tenantId, offers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "offer_properties_property_fkey",
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete("restrict"),
    index("offer_properties_property_idx").on(t.tenantId, t.propertyId),
    check(
      "offer_properties_extras_service_id_valid",
      sql`${t.extrasServiceId} IS NULL OR ${t.extrasServiceId} ~ '^[A-Za-z0-9_-]{1,120}$'`,
    ),
    uniqueIndex("offer_properties_legacy_key_idx").on(t.tenantId, t.legacyKey),
    uniqueIndex("offer_properties_apaleo_service_idx").on(
      t.tenantId,
      t.propertyId,
      t.extrasServiceId,
    ),
    foreignKey({
      name: "offer_properties_updated_by_fkey",
      columns: [t.tenantId, t.updatedBy],
      foreignColumns: [adminUsers.tenantId, adminUsers.id],
    }).onDelete("set null"),
    check(
      "offer_properties_action_type_valid",
      sql`${t.actionType} IS NULL OR ${oneOf(t.actionType, SERVICE_ACTION_TYPES)}`,
    ),
    check(
      "offer_properties_booking_rule_valid",
      sql`${t.bookingRule} IS NULL OR ${oneOf(t.bookingRule, BOOKING_RULES)}`,
    ),
    check(
      "offer_properties_fulfillment_valid",
      sql`${t.fulfillment} IS NULL OR ${oneOf(t.fulfillment, FULFILLMENT_TYPES)}`,
    ),
    // Additional guests are always booked instantly and only while capacity is left (Extras).
    check(
      "offer_properties_occupancy_shape",
      sql`${t.actionType} IS DISTINCT FROM 'increase_occupancy'
        OR (coalesce(${t.fulfillment}, 'instant') = 'instant' AND ${t.requiresRemainingCapacity})`,
    ),
    check(
      "offer_properties_extra_person_price_valid",
      sql`(${t.extraPersonPriceCents} IS NULL OR ${t.extraPersonPriceCents} BETWEEN 0 AND 10000000)
        AND (${t.extraPersonPriceCents} IS NULL OR ${t.actionType} = 'increase_occupancy')
        AND (${t.currency} IS NULL OR ${t.currency} ~ '^[A-Z]{3}$')`,
    ),
    check(
      "offer_properties_unit_groups_valid",
      sql`cardinality(${t.allowedUnitGroupIds}) <= 50
        AND array_to_string(${t.allowedUnitGroupIds}, ',') ~ '^[A-Za-z0-9_,-]*$'`,
    ),
    check(
      "offer_properties_legacy_key_valid",
      sql`${t.legacyKey} IS NULL OR ${t.legacyKey} ~ '^[A-Za-z0-9_-]{1,40}:[A-Za-z0-9_-]{1,120}$'`,
    ),
    check(
      "offer_properties_imported_hash_valid",
      sql`${t.importedHash} IS NULL OR ${isSha256Hex(t.importedHash)}`,
    ),
  ],
).enableRLS();

/**
 * Success measurement: daily totals per offer, property and placement – never per guest
 * (no reservation, session or IP), so no profiles can arise.
 */
export const offerMetricsDaily = pgTable(
  "offer_metrics_daily",
  {
    tenantId: text("tenant_id").notNull(),
    propertyId: text("property_id").notNull(),
    offerId: uuid("offer_id").notNull(),
    day: date("day").notNull(),
    placement: text("placement", { enum: OFFER_PLACEMENTS }).notNull(),
    impressions: integer("impressions").notNull().default(0),
    views: integer("views").notNull().default(0),
    clickOuts: integer("click_outs").notNull().default(0),
    requests: integer("requests").notNull().default(0),
    bookings: integer("bookings").notNull().default(0),
    revenueCents: bigint("revenue_cents", { mode: "number" }).notNull().default(0),
    commissionCents: bigint("commission_cents", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "offer_metrics_daily_pkey",
      columns: [t.tenantId, t.propertyId, t.offerId, t.day, t.placement],
    }),
    foreignKey({
      name: "offer_metrics_daily_offer_fkey",
      columns: [t.tenantId, t.offerId],
      foreignColumns: [offers.tenantId, offers.id],
    }).onDelete("cascade"),
    check("offer_metrics_daily_placement_valid", oneOf(t.placement, OFFER_PLACEMENTS)),
    check(
      "offer_metrics_daily_counts_valid",
      sql`${t.impressions} >= 0 AND ${t.views} >= 0 AND ${t.clickOuts} >= 0 AND ${t.requests} >= 0
        AND ${t.bookings} >= 0 AND ${t.revenueCents} >= 0 AND ${t.commissionCents} >= 0`,
    ),
  ],
).enableRLS();

/**
 * Requests for an offer (partner offers via UNIQUE PLACES, own services "auf Anfrage") –
 * prepared in Phase 1, used from Phase 2 on. Personal data limited to what handling needs;
 * removed with the stay's retention (`purge_after`).
 */
export const OFFER_REQUEST_STATUSES = ["pending", "confirmed", "declined", "cancelled"] as const;
/** Where a record was created: in STAY, or imported from the Extras app (migration). */
export const RECORD_SOURCES = ["stay", "extras"] as const;

export const offerRequests = pgTable(
  "offer_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    offerId: uuid("offer_id").notNull(),
    propertyId: text("property_id").notNull(),
    reservationProvider: text("reservation_provider", { enum: RESERVATION_PROVIDERS }).notNull(),
    externalReservationId: text("external_reservation_id").notNull(),
    status: text("status", { enum: OFFER_REQUEST_STATUSES }).notNull().default("pending"),
    requestedDate: date("requested_date"),
    requestedTime: text("requested_time"),
    people: integer("people"),
    note: text("note"),
    placement: text("placement", { enum: OFFER_PLACEMENTS }),
    /** Price shown to the guest when requesting (cents) – for the overview, not a charge. */
    quotedCents: integer("quoted_cents"),
    currency: text("currency"),
    handledBy: uuid("handled_by"),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    slackNotifiedAt: timestamp("slack_notified_at", { withTimezone: true }),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    /* ── Own services (M1, Extras "Auf Anfrage") */
    apaleoServiceId: text("apaleo_service_id"),
    quantity: integer("quantity"),
    /** Every date the shown price covered (e.g. all nights). */
    requestedDates: date("requested_dates").array(),
    /** Dates actually booked in Apaleo on approval. */
    bookedServiceDates: date("booked_service_dates").array(),
    /** stay = created in STAY · extras = imported from the Extras app. */
    source: text("source", { enum: RECORD_SOURCES }).notNull().default("stay"),
    legacyId: text("legacy_id"),
    /** Client key of the guest submit (M4): a repeated submit returns the same request. */
    idempotencyKey: text("idempotency_key"),
    /** Optional internal reason of a decision (M4), shown to the team only. */
    decisionReason: text("decision_reason"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("offer_requests_legacy_id_idx").on(t.tenantId, t.legacyId),
    uniqueIndex("offer_requests_idempotency_idx").on(t.tenantId, t.idempotencyKey),
    check(
      "offer_requests_m4_values_valid",
      sql`(${t.idempotencyKey} IS NULL OR ${t.idempotencyKey} ~ '^[A-Za-z0-9_:.-]{8,200}$')
        AND (${t.decisionReason} IS NULL OR (char_length(${t.decisionReason}) BETWEEN 1 AND 500 AND ${t.decisionReason} !~ '[<>]'))`,
    ),
    check("offer_requests_source_valid", oneOf(t.source, RECORD_SOURCES)),
    check(
      "offer_requests_service_valid",
      sql`(${t.apaleoServiceId} IS NULL OR ${t.apaleoServiceId} ~ '^[A-Za-z0-9_-]{1,120}$')
        AND (${t.quantity} IS NULL OR ${t.quantity} BETWEEN 1 AND 50)
        AND (${t.legacyId} IS NULL OR char_length(${t.legacyId}) BETWEEN 1 AND 100)`,
    ),
    foreignKey({
      name: "offer_requests_offer_fkey",
      columns: [t.tenantId, t.offerId],
      foreignColumns: [offers.tenantId, offers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "offer_requests_handled_by_fkey",
      columns: [t.tenantId, t.handledBy],
      foreignColumns: [adminUsers.tenantId, adminUsers.id],
    }).onDelete("restrict"),
    index("offer_requests_reservation_idx").on(
      t.tenantId,
      t.reservationProvider,
      t.externalReservationId,
    ),
    index("offer_requests_status_idx").on(t.tenantId, t.status, t.createdAt),
    index("offer_requests_purge_idx").on(t.purgeAfter),
    check("offer_requests_status_valid", oneOf(t.status, OFFER_REQUEST_STATUSES)),
    check(
      "offer_requests_values_valid",
      sql`(${t.people} IS NULL OR ${t.people} BETWEEN 1 AND 50)
        AND (${t.requestedTime} IS NULL OR ${t.requestedTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
        AND (${t.note} IS NULL OR (char_length(${t.note}) <= 500 AND ${t.note} !~ '[<>]'))
        AND (${t.quotedCents} IS NULL OR ${t.quotedCents} >= 0)
        AND (${t.currency} IS NULL OR ${t.currency} ~ '^[A-Z]{3}$')
        AND ((${t.handledBy} IS NULL) = (${t.handledAt} IS NULL))`,
    ),
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

export const ADDRESS_SOURCES = ["own", "same-as-primary"] as const;

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
    birthDate: date("birth_date", { mode: "string" }),
    nationality: text("nationality"),
    street: text("street"),
    postalCode: text("postal_code"),
    city: text("city"),
    country: text("country"),
    documentType: text("document_type", { enum: DOCUMENT_TYPES }),
    documentNumber: text("document_number"),
    /**
     * Fellow travellers: "same-as-primary" = the main guest's address (a reference, so the
     * address columns stay empty; ADR 0021).
     */
    addressSource: text("address_source", { enum: ADDRESS_SOURCES }).notNull().default("own"),
    /** Formal plausibility of the own address at the last save (never "verified"). */
    addressStatus: text("address_status", { enum: ADDRESS_STATUSES }),
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
      "guest_registration_guests_address_source_valid",
      sql`${oneOf(t.addressSource, ADDRESS_SOURCES)} AND (${t.position} > 0 OR ${t.addressSource} = 'own')
        AND (${t.addressSource} = 'own' OR (${t.street} IS NULL AND ${t.postalCode} IS NULL AND ${t.city} IS NULL AND ${t.country} IS NULL))`,
    ),
    check(
      "guest_registration_guests_address_status_valid",
      sql`${t.addressStatus} IS NULL OR ${oneOf(t.addressStatus, ADDRESS_STATUSES)}`,
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
 * Operational contact data of a traveller (ADR 0021): e-mail (main guest) and mobile number –
 * kept apart from the legal registration data in guest_registration_guests, with its own
 * purpose, verification state and (shorter) retention. One row per traveller slot.
 */
export const guestRegistrationContacts = pgTable(
  "guest_registration_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    registrationId: uuid("registration_id").notNull(),
    position: integer("position").notNull(),
    /** Main guest only: a directly reachable address (channel relays are refused). */
    email: text("email"),
    /** Mobile number, E.164. */
    phone: text("phone"),
    /** Confirmation by code (C4): when, and the HMAC of the confirmed value. */
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    emailVerifiedHash: text("email_verified_hash"),
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    phoneVerifiedHash: text("phone_verified_hash"),
    /**
     * Documented staff exception instead of a code (C4/C5): who, when, why. Never counts as
     * "verified"; cleared when the value changes.
     */
    emailWaivedAt: timestamp("email_waived_at", { withTimezone: true }),
    emailWaivedBy: uuid("email_waived_by"),
    emailWaiverReason: text("email_waiver_reason", { enum: WAIVER_REASONS }),
    emailWaiverNote: text("email_waiver_note"),
    phoneWaivedAt: timestamp("phone_waived_at", { withTimezone: true }),
    phoneWaivedBy: uuid("phone_waived_by"),
    phoneWaiverReason: text("phone_waiver_reason", { enum: WAIVER_REASONS }),
    phoneWaiverNote: text("phone_waiver_note"),
    /** Contact data may be removed after this instant (contact retention). */
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "guest_registration_contacts_registration_fkey",
      columns: [t.tenantId, t.registrationId],
      foreignColumns: [guestRegistrations.tenantId, guestRegistrations.id],
    }).onDelete("cascade"),
    unique("guest_registration_contacts_position_key").on(t.registrationId, t.position),
    index("guest_registration_contacts_purge_after_idx").on(t.purgeAfter),
    check(
      "guest_registration_contacts_position_range",
      sql`${t.position} BETWEEN 0 AND ${sql.raw(String(MAX_TRAVELLERS - 1))}`,
    ),
    check(
      "guest_registration_contacts_email_valid",
      sql`${t.email} IS NULL OR (${t.email} = lower(${t.email})
        AND char_length(${t.email}) BETWEEN 3 AND 254 AND position('@' in ${t.email}) > 1
        AND ${t.email} !~ '@([a-z0-9-]+\\.)*guest\\.booking\\.com$')`,
    ),
    check(
      "guest_registration_contacts_phone_e164",
      sql`${t.phone} IS NULL OR ${t.phone} ~ '^\\+[1-9][0-9]{6,14}$'`,
    ),
    check(
      "guest_registration_contacts_email_verified_consistent",
      sql`(${t.emailVerifiedAt} IS NULL) = (${t.emailVerifiedHash} IS NULL) AND (${t.emailVerifiedHash} IS NULL OR ${isSha256Hex(t.emailVerifiedHash)})`,
    ),
    check(
      "guest_registration_contacts_phone_verified_consistent",
      sql`(${t.phoneVerifiedAt} IS NULL) = (${t.phoneVerifiedHash} IS NULL) AND (${t.phoneVerifiedHash} IS NULL OR ${isSha256Hex(t.phoneVerifiedHash)})`,
    ),
    ...(["email", "phone"] as const).map((channel) => {
      const at = channel === "email" ? t.emailWaivedAt : t.phoneWaivedAt;
      const by = channel === "email" ? t.emailWaivedBy : t.phoneWaivedBy;
      const reason = channel === "email" ? t.emailWaiverReason : t.phoneWaiverReason;
      const note = channel === "email" ? t.emailWaiverNote : t.phoneWaiverNote;
      return check(
        `guest_registration_contacts_${channel}_waiver_valid`,
        sql`((${at} IS NULL) = (${by} IS NULL) AND (${at} IS NULL) = (${reason} IS NULL))
        AND (${reason} IS NULL OR ${reason} IN (${sql.raw(WAIVER_REASONS.map((r) => `'${r}'`).join(", "))}))
        AND (${note} IS NULL OR (${at} IS NOT NULL AND char_length(${note}) <= 300 AND ${note} !~ '[<>[:cntrl:]]'))
        AND (${reason} IS DISTINCT FROM 'other' OR char_length(coalesce(${note}, '')) >= 5)`,
      );
    }),
    foreignKey({
      name: "guest_registration_contacts_email_waived_by_fkey",
      columns: [t.tenantId, t.emailWaivedBy],
      foreignColumns: [adminUsers.tenantId, adminUsers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "guest_registration_contacts_phone_waived_by_fkey",
      columns: [t.tenantId, t.phoneWaivedBy],
      foreignColumns: [adminUsers.tenantId, adminUsers.id],
    }).onDelete("restrict"),
  ],
).enableRLS();

/**
 * One-time codes for contact verification (ADR 0021, C4/C5). Only HMACs: the code hash is
 * bound to the challenge id and a server pepper, the target hash identifies the address /
 * number without storing it twice. Rows also serve as the send history for the limits.
 */
export const contactVerificationChallenges = pgTable(
  "contact_verification_challenges",
  {
    id: uuid("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    registrationId: uuid("registration_id").notNull(),
    position: integer("position").notNull().default(0),
    channel: text("channel", { enum: OTP_CHANNELS }).notNull(),
    targetHash: text("target_hash").notNull(),
    codeHash: text("code_hash").notNull(),
    status: text("status", { enum: OTP_CHALLENGE_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    delivery: text("delivery", { enum: VERIFICATION_DELIVERIES }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "contact_verification_challenges_registration_fkey",
      columns: [t.tenantId, t.registrationId],
      foreignColumns: [guestRegistrations.tenantId, guestRegistrations.id],
    }).onDelete("cascade"),
    index("contact_verification_challenges_history_idx").on(
      t.tenantId,
      t.registrationId,
      t.channel,
      t.createdAt,
    ),
    index("contact_verification_challenges_target_idx").on(t.targetHash, t.createdAt),
    check("contact_verification_challenges_target_hash_format", isSha256Hex(t.targetHash)),
    check("contact_verification_challenges_code_hash_format", isSha256Hex(t.codeHash)),
    check(
      "contact_verification_challenges_position_range",
      sql`${t.position} BETWEEN 0 AND ${sql.raw(String(MAX_TRAVELLERS - 1))}`,
    ),
    check("contact_verification_challenges_attempts_range", sql`${t.attempts} BETWEEN 0 AND 20`),
    check(
      "contact_verification_challenges_verified_consistent",
      sql`(${t.status} = 'verified') = (${t.verifiedAt} IS NOT NULL)`,
    ),
    check(
      "contact_verification_challenges_failed_not_pending",
      sql`${t.delivery} <> 'failed' OR ${t.status} <> 'pending'`,
    ),
  ],
).enableRLS();

/**
 * Audit trail of contact verification: what happened when, by whom – no addresses, numbers
 * or codes. Append-only (trigger in 0016); removed with its check-in.
 */
export const contactVerificationEvents = pgTable(
  "contact_verification_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    registrationId: uuid("registration_id").notNull(),
    position: integer("position").notNull().default(0),
    channel: text("channel", { enum: OTP_CHANNELS }).notNull(),
    event: text("event", { enum: CONTACT_VERIFICATION_EVENTS }).notNull(),
    actor: text("actor", { enum: VERIFICATION_ACTORS }).notNull(),
    adminUserId: uuid("admin_user_id"),
    waiverReason: text("waiver_reason", { enum: WAIVER_REASONS }),
    challengeId: uuid("challenge_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "contact_verification_events_registration_fkey",
      columns: [t.tenantId, t.registrationId],
      foreignColumns: [guestRegistrations.tenantId, guestRegistrations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "contact_verification_events_admin_fkey",
      columns: [t.tenantId, t.adminUserId],
      foreignColumns: [adminUsers.tenantId, adminUsers.id],
    }).onDelete("restrict"),
    index("contact_verification_events_registration_idx").on(
      t.tenantId,
      t.registrationId,
      t.occurredAt,
    ),
    check(
      "contact_verification_events_actor_consistent",
      sql`(${t.actor} = 'admin') = (${t.adminUserId} IS NOT NULL)`,
    ),
    check(
      "contact_verification_events_waiver_reason",
      sql`(${t.event} = 'waived') = (${t.waiverReason} IS NOT NULL)`,
    ),
  ],
).enableRLS();

/**
 * Invoice recipient chosen in the check-in (ADR 0021): private (the registration address) or
 * a company – stored apart from the private registration address, which it never changes.
 * Nothing here is sent to the PMS (folio write-back is a separate, disabled phase).
 */
export const guestRegistrationBilling = pgTable(
  "guest_registration_billing",
  {
    tenantId: text("tenant_id").notNull(),
    registrationId: uuid("registration_id").notNull(),
    kind: text("kind", { enum: BILLING_KINDS }).notNull(),
    companyName: text("company_name"),
    street: text("street"),
    postalCode: text("postal_code"),
    city: text("city"),
    country: text("country"),
    vatId: text("vat_id"),
    contactFirstName: text("contact_first_name"),
    contactLastName: text("contact_last_name"),
    addressStatus: text("address_status", { enum: ADDRESS_STATUSES }),
    ...timestamps,
  },
  (t) => [
    primaryKey({
      name: "guest_registration_billing_pkey",
      columns: [t.tenantId, t.registrationId],
    }),
    foreignKey({
      name: "guest_registration_billing_registration_fkey",
      columns: [t.tenantId, t.registrationId],
      foreignColumns: [guestRegistrations.tenantId, guestRegistrations.id],
    }).onDelete("cascade"),
    check("guest_registration_billing_kind_valid", oneOf(t.kind, BILLING_KINDS)),
    check(
      "guest_registration_billing_shape",
      sql`(${t.kind} = 'private' AND ${t.companyName} IS NULL AND ${t.street} IS NULL AND ${t.postalCode} IS NULL AND ${t.city} IS NULL AND ${t.country} IS NULL AND ${t.vatId} IS NULL AND ${t.contactFirstName} IS NULL AND ${t.contactLastName} IS NULL AND ${t.addressStatus} IS NULL)
        OR (${t.kind} = 'company' AND ${t.companyName} IS NOT NULL AND ${t.street} IS NOT NULL AND ${t.city} IS NOT NULL AND ${t.country} ~ '^[A-Z]{2}$' AND ${t.addressStatus} IS NOT NULL)`,
    ),
    check(
      "guest_registration_billing_contact_person",
      sql`(${t.contactFirstName} IS NULL) = (${t.contactLastName} IS NULL)`,
    ),
    check(
      "guest_registration_billing_vat_id_format",
      sql`${t.vatId} IS NULL OR ${t.vatId} ~ '^[A-Z]{2}[A-Z0-9+*]{2,14}$'`,
    ),
    check(
      "guest_registration_billing_address_status_valid",
      sql`${t.addressStatus} IS NULL OR ${oneOf(t.addressStatus, ADDRESS_STATUSES)}`,
    ),
    check(
      "guest_registration_billing_text_lengths",
      sql`(${maxLength(t.companyName, 200)}) AND (${maxLength(t.street, 200)}) AND (${maxLength(t.postalCode, 12)})
        AND (${maxLength(t.city, 100)}) AND (${maxLength(t.contactFirstName, 100)}) AND (${maxLength(t.contactLastName, 100)})`,
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
    /** Role (M1): owner | admin | manager | viewer – read on every request. */
    role: text("role", { enum: ADMIN_ROLES }).notNull().default("viewer"),
    /** all = every property of the tenant · selected = only admin_user_properties. */
    propertyScope: text("property_scope", { enum: PROPERTY_SCOPES }).notNull().default("all"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("admin_users_email_key").on(t.email),
    check("admin_users_role_valid", oneOf(t.role, ADMIN_ROLES)),
    check("admin_users_property_scope_valid", oneOf(t.propertyScope, PROPERTY_SCOPES)),
    check(
      "admin_users_owner_all_properties",
      sql`${t.role} <> 'owner' OR ${t.propertyScope} = 'all'`,
    ),
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

/*
 * ── Payments (Phase 12 B1, ADR 0018) ───────────────────────────────────────────────────
 * IDs, amounts (minor units) and states only – never card data, payment-link URLs or raw
 * provider responses. Every row is tenant/property-bound (composite FKs); RLS on, no
 * policies, Data API privileges revoked (migration 0012).
 */
export const PAYMENT_PROVIDERS = ["apaleo"] as const;
/** preparing: row reserved, link not created yet (Phase B2) · pending: link live at the provider */
export const PAYMENT_REQUEST_STATUSES = [
  "preparing",
  "pending",
  "succeeded",
  "failed",
  "canceled",
  "expired",
] as const;
export const OPEN_PAYMENT_REQUEST_STATUSES = ["preparing", "pending"] as const;
/** Mirrors @up/core PaymentState. */
export const PAYMENT_STATES = [
  "not-applicable",
  "not-due",
  "due",
  "pending",
  "paid",
  "credit",
  "review",
  "unknown",
] as const;
export const PAYMENT_AUDIT_KINDS = [
  "state-observed",
  "payment-confirmed",
  "request-created",
  "request-status-changed",
] as const;
export const PAYMENT_AUDIT_ACTORS = ["system", "guest", "admin"] as const;

function isCurrency(column: AnyPgColumn): SQL {
  return sql`${column} ~ '^[A-Z]{3}$'`;
}

/**
 * One payment request (a hosted payment link, Phase B2) for ONE folio of ONE reservation.
 * At most one open request (preparing/pending) per folio – enforced by a partial unique
 * index, so double clicks, parallel tabs or retries can never create a second one.
 */
export const paymentRequests = pgTable(
  "payment_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    propertyId: text("property_id").notNull(),
    reservationProvider: text("reservation_provider", { enum: RESERVATION_PROVIDERS }).notNull(),
    externalReservationId: text("external_reservation_id").notNull(),
    /** Booking of the reservation (several reservations can share it). */
    externalBookingId: text("external_booking_id"),
    paymentProvider: text("payment_provider", { enum: PAYMENT_PROVIDERS }).notNull(),
    /** The provider's folio id – a booking can have several folios per reservation. */
    folioId: text("folio_id").notNull(),
    /** The provider's payment id once the link exists. */
    providerPaymentId: text("provider_payment_id"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    status: text("status", { enum: PAYMENT_REQUEST_STATUSES }).notNull().default("preparing"),
    /** SHA-256 hex – sent as the provider's Idempotency-Key. */
    idempotencyKey: text("idempotency_key").notNull(),
    /** Random, opaque reference in the return URL (never an id or amount). */
    returnRef: text("return_ref").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "payment_requests_property_fkey",
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete("restrict"),
    unique("payment_requests_tenant_id_id_key").on(t.tenantId, t.id),
    unique("payment_requests_idempotency_key_key").on(t.paymentProvider, t.idempotencyKey),
    unique("payment_requests_return_ref_key").on(t.returnRef),
    uniqueIndex("payment_requests_provider_payment_key")
      .on(t.paymentProvider, t.providerPaymentId)
      .where(sql`${t.providerPaymentId} IS NOT NULL`),
    // The duplicate guard: one open request per folio.
    uniqueIndex("payment_requests_one_open_per_folio")
      .on(t.tenantId, t.paymentProvider, t.folioId)
      .where(sql`${t.status} IN ('preparing', 'pending')`),
    index("payment_requests_reservation_idx").on(
      t.tenantId,
      t.reservationProvider,
      t.externalReservationId,
    ),
    index("payment_requests_open_due_idx").on(t.status, t.expiresAt),
    check(
      "payment_requests_reservation_provider_valid",
      oneOf(t.reservationProvider, RESERVATION_PROVIDERS),
    ),
    check("payment_requests_payment_provider_valid", oneOf(t.paymentProvider, PAYMENT_PROVIDERS)),
    check("payment_requests_status_valid", oneOf(t.status, PAYMENT_REQUEST_STATUSES)),
    check(
      "payment_requests_external_reservation_id_not_blank",
      notBlank(t.externalReservationId, 255),
    ),
    check("payment_requests_external_booking_id_length", maxLength(t.externalBookingId, 255)),
    check("payment_requests_folio_id_not_blank", notBlank(t.folioId, 255)),
    check("payment_requests_provider_payment_id_length", maxLength(t.providerPaymentId, 255)),
    check("payment_requests_amount_positive", sql`${t.amountMinor} > 0`),
    check("payment_requests_currency_format", isCurrency(t.currency)),
    check("payment_requests_idempotency_key_format", isSha256Hex(t.idempotencyKey)),
    check("payment_requests_return_ref_format", sql`${t.returnRef} ~ '^[A-Za-z0-9_-]{32,64}$'`),
    // A live or paid link always has the provider's payment id.
    check(
      "payment_requests_provider_payment_id_required",
      sql`${t.status} NOT IN ('pending', 'succeeded') OR ${t.providerPaymentId} IS NOT NULL`,
    ),
    // Final states carry the instant they were settled – and only they do.
    check(
      "payment_requests_settled_consistent",
      sql`(${t.status} IN ('succeeded', 'failed', 'canceled', 'expired')) = (${t.settledAt} IS NOT NULL)`,
    ),
  ],
).enableRLS();

/**
 * Current payment state per reservation: last evaluation and – write-once – when the
 * guest's amount was first confirmed by the provider (`cleared_at`). A confirmed payment
 * stays confirmed: later extras or an outage never lock access again (rules 2 and 3).
 */
export const reservationPaymentStates = pgTable(
  "reservation_payment_states",
  {
    tenantId: text("tenant_id").notNull(),
    propertyId: text("property_id").notNull(),
    reservationProvider: text("reservation_provider", { enum: RESERVATION_PROVIDERS }).notNull(),
    externalReservationId: text("external_reservation_id").notNull(),
    externalBookingId: text("external_booking_id"),
    lastState: text("last_state", { enum: PAYMENT_STATES }).notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull(),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    clearedAmountMinor: integer("cleared_amount_minor"),
    clearedCurrency: text("cleared_currency"),
    ...timestamps,
  },
  (t) => [
    primaryKey({
      name: "reservation_payment_states_pkey",
      columns: [t.tenantId, t.reservationProvider, t.externalReservationId],
    }),
    foreignKey({
      name: "reservation_payment_states_property_fkey",
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete("restrict"),
    check(
      "reservation_payment_states_reservation_provider_valid",
      oneOf(t.reservationProvider, RESERVATION_PROVIDERS),
    ),
    check("reservation_payment_states_last_state_valid", oneOf(t.lastState, PAYMENT_STATES)),
    check(
      "reservation_payment_states_external_reservation_id_not_blank",
      notBlank(t.externalReservationId, 255),
    ),
    check(
      "reservation_payment_states_external_booking_id_length",
      maxLength(t.externalBookingId, 255),
    ),
    check(
      "reservation_payment_states_cleared_consistent",
      sql`(${t.clearedAt} IS NULL AND ${t.clearedAmountMinor} IS NULL AND ${t.clearedCurrency} IS NULL) OR (${t.clearedAt} IS NOT NULL AND ${t.clearedAmountMinor} > 0 AND ${isCurrency(t.clearedCurrency)})`,
    ),
  ],
).enableRLS();

/**
 * Append-only audit trail of payment observations and requests (revision-safe: UPDATE,
 * DELETE and TRUNCATE are rejected by triggers, migration 0012). IDs, amounts, states and
 * instants only – no personal or card data.
 */
export const paymentAuditEvents = pgTable(
  "payment_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    propertyId: text("property_id").notNull(),
    reservationProvider: text("reservation_provider", { enum: RESERVATION_PROVIDERS }).notNull(),
    externalReservationId: text("external_reservation_id").notNull(),
    folioId: text("folio_id"),
    paymentRequestId: uuid("payment_request_id"),
    kind: text("kind", { enum: PAYMENT_AUDIT_KINDS }).notNull(),
    state: text("state"),
    amountMinor: integer("amount_minor"),
    currency: text("currency"),
    /** The provider payments this event is based on (e.g. the confirmed ones). */
    providerPaymentIds: text("provider_payment_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** When the provider data was read (the "Prüfzeitpunkt"). */
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    actor: text("actor", { enum: PAYMENT_AUDIT_ACTORS }).notNull().default("system"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "payment_audit_events_property_fkey",
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "payment_audit_events_request_fkey",
      columns: [t.tenantId, t.paymentRequestId],
      foreignColumns: [paymentRequests.tenantId, paymentRequests.id],
    }).onDelete("restrict"),
    index("payment_audit_events_reservation_idx").on(
      t.tenantId,
      t.reservationProvider,
      t.externalReservationId,
      t.observedAt,
    ),
    check("payment_audit_events_kind_valid", oneOf(t.kind, PAYMENT_AUDIT_KINDS)),
    check("payment_audit_events_actor_valid", oneOf(t.actor, PAYMENT_AUDIT_ACTORS)),
    check(
      "payment_audit_events_reservation_provider_valid",
      oneOf(t.reservationProvider, RESERVATION_PROVIDERS),
    ),
    check(
      "payment_audit_events_state_valid",
      sql`${t.state} IS NULL OR ${t.state} IN (${sql.raw([...new Set([...PAYMENT_STATES, ...PAYMENT_REQUEST_STATUSES])].map((v) => `'${v}'`).join(", "))})`,
    ),
    check(
      "payment_audit_events_amount_currency",
      sql`(${t.amountMinor} IS NULL) = (${t.currency} IS NULL) AND (${t.currency} IS NULL OR ${isCurrency(t.currency)})`,
    ),
    check("payment_audit_events_folio_id_length", maxLength(t.folioId, 255)),
  ],
).enableRLS();

/* ------------------------------------------------------------------------------------------
 * Official guest registration (Meldewesen, Feratel) – ADR 0022, phase F2
 *
 * Four tables, all without personal data:
 * - official_registration_settings: per tenant, property and target (timing, confirmed
 *   operations, retention). Enabled only with the simulated environment (CHECK) until approved.
 * - official_registrations: state per check-in / reservation and target – the duplicate guard
 *   (one row per registration and per reservation, unique references, unresolved calls).
 * - official_guest_cards: guest card status, separate from the registration status.
 * - official_registration_events: append-only protocol (triggers in migration 0014).
 * ---------------------------------------------------------------------------------------- */

export const OFFICIAL_EVENT_OPERATIONS = [
  ...OFFICIAL_OPERATIONS,
  "handover-to-staff",
  "admin-retry",
  "admin-resolve",
  "guest-card-update",
] as const;
export const OFFICIAL_EVENT_RESULTS = [
  "ok",
  "rejected",
  "temporary",
  "ambiguous",
  "not-supported",
  "manual",
  "skipped",
] as const;
export const OFFICIAL_EVENT_ACTORS = ["system", "admin"] as const;
export const GUEST_CARD_DELIVERY_CHANNELS = ["target-email", "app", "print"] as const;

function sqlList(values: Iterable<string>): SQL {
  return sql.raw([...values].map((value) => `'${value}'`).join(", "));
}

function retentionDays(column: AnyPgColumn): SQL {
  return sql`${column} IS NULL OR ${column} BETWEEN 1 AND 3650`;
}

export const officialRegistrationSettings = pgTable(
  "official_registration_settings",
  {
    tenantId: text("tenant_id").notNull(),
    propertyId: text("property_id").notNull(),
    target: text("target", { enum: OFFICIAL_REGISTRATION_TARGETS }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    environment: text("environment", { enum: OFFICIAL_ENVIRONMENTS })
      .notNull()
      .default("simulated"),
    /** When the binding registration form is due (per destination). */
    bindingRegistrationRule: text("binding_registration_rule", { enum: BINDING_REGISTRATION_RULES })
      .notNull()
      .default("arrival-day"),
    bindingRegistrationDays: integer("binding_registration_days"),
    preRegistrationLeadDays: integer("pre_registration_lead_days"),
    /** Operations confirmed for this destination – effective = documented ∩ allowed. */
    allowedOperations: text("allowed_operations")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    guestCards: boolean("guest_cards").notNull().default(false),
    childUnderAge: integer("child_under_age").notNull(),
    /** Non-secret values (e.g. mapping code). Credentials never live in the database. */
    providerSettings: jsonb("provider_settings")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    stateRetentionDays: integer("state_retention_days"),
    eventRetentionDays: integer("event_retention_days"),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    primaryKey({
      name: "official_registration_settings_pkey",
      columns: [t.tenantId, t.propertyId, t.target],
    }),
    foreignKey({
      name: "official_registration_settings_property_fkey",
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete("restrict"),
    check(
      "official_registration_settings_target_valid",
      oneOf(t.target, OFFICIAL_REGISTRATION_TARGETS),
    ),
    check(
      "official_registration_settings_environment_valid",
      oneOf(t.environment, OFFICIAL_ENVIRONMENTS),
    ),
    // Guard until explicit approval: only the simulated environment can be switched on.
    check(
      "official_registration_settings_live_guard",
      sql`NOT ${t.enabled} OR ${t.environment} = 'simulated'`,
    ),
    check(
      "official_registration_settings_rule_valid",
      oneOf(t.bindingRegistrationRule, BINDING_REGISTRATION_RULES),
    ),
    check(
      "official_registration_settings_rule_days",
      sql`(${t.bindingRegistrationRule} = 'days-before-arrival') = (${t.bindingRegistrationDays} IS NOT NULL) AND (${t.bindingRegistrationDays} IS NULL OR ${t.bindingRegistrationDays} BETWEEN 1 AND 30)`,
    ),
    check(
      "official_registration_settings_lead_days",
      sql`${t.preRegistrationLeadDays} IS NULL OR ${t.preRegistrationLeadDays} BETWEEN 1 AND 365`,
    ),
    check(
      "official_registration_settings_operations_known",
      sql`${t.allowedOperations} <@ ARRAY[${sqlList(OFFICIAL_OPERATIONS)}]::text[]`,
    ),
    check("official_registration_settings_child_age", sql`${t.childUnderAge} BETWEEN 1 AND 18`),
    check(
      "official_registration_settings_provider_settings_object",
      sql`jsonb_typeof(${t.providerSettings}) = 'object' AND octet_length(${t.providerSettings}::text) <= 4096`,
    ),
    check("official_registration_settings_state_retention", retentionDays(t.stateRetentionDays)),
    check("official_registration_settings_event_retention", retentionDays(t.eventRetentionDays)),
    check("official_registration_settings_version_positive", sql`${t.version} > 0`),
  ],
).enableRLS();

export const officialRegistrations = pgTable(
  "official_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    propertyId: text("property_id").notNull(),
    target: text("target", { enum: OFFICIAL_REGISTRATION_TARGETS }).notNull(),
    /** The canonical check-in (guest_registrations) this state belongs to. */
    registrationId: uuid("registration_id").notNull(),
    reservationProvider: text("reservation_provider", { enum: RESERVATION_PROVIDERS }).notNull(),
    externalReservationId: text("external_reservation_id").notNull(),
    /** Our non-personal reference at the target: 'up-' || registration_id. */
    ourReference: text("our_reference").notNull(),
    stage: text("stage", { enum: REMOTE_STAGES }).notNull().default("none"),
    transmission: text("transmission", { enum: TRANSMISSION_STATUSES })
      .notNull()
      .default("pending"),
    externalReference: text("external_reference"),
    acceptedFingerprint: text("accepted_fingerprint"),
    acceptedGuestFingerprint: text("accepted_guest_fingerprint"),
    acceptedArrivalDate: date("accepted_arrival_date", { mode: "string" }),
    acceptedDepartureDate: date("accepted_departure_date", { mode: "string" }),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    /** Worker lease – a second worker cannot process the same row meanwhile. */
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastErrorCode: text("last_error_code", { enum: OFFICIAL_ERROR_CODES }),
    manualReason: text("manual_reason", { enum: MANUAL_REASONS }),
    /** A creating call with unknown outcome – reconciled before anything else is sent. */
    unresolvedOperation: text("unresolved_operation", { enum: OFFICIAL_OPERATIONS }),
    unresolvedIdempotencyKey: text("unresolved_idempotency_key"),
    unresolvedFingerprint: text("unresolved_fingerprint"),
    unresolvedGuestFingerprint: text("unresolved_guest_fingerprint"),
    unresolvedArrivalDate: date("unresolved_arrival_date", { mode: "string" }),
    unresolvedDepartureDate: date("unresolved_departure_date", { mode: "string" }),
    unresolvedAt: timestamp("unresolved_at", { withTimezone: true }),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    unique("official_registrations_tenant_id_id_key").on(t.tenantId, t.id),
    // Duplicate guards: one state per check-in and target, and per reservation and target.
    unique("official_registrations_registration_key").on(t.tenantId, t.registrationId, t.target),
    unique("official_registrations_reservation_key").on(
      t.tenantId,
      t.reservationProvider,
      t.externalReservationId,
      t.target,
    ),
    unique("official_registrations_our_reference_key").on(t.target, t.ourReference),
    uniqueIndex("official_registrations_external_reference_key")
      .on(t.target, t.externalReference)
      .where(sql`${t.externalReference} IS NOT NULL`),
    index("official_registrations_due_idx").on(t.transmission, t.nextAttemptAt),
    index("official_registrations_property_idx").on(t.tenantId, t.propertyId, t.transmission),
    foreignKey({
      name: "official_registrations_registration_fkey",
      columns: [t.tenantId, t.registrationId],
      foreignColumns: [guestRegistrations.tenantId, guestRegistrations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "official_registrations_settings_fkey",
      columns: [t.tenantId, t.propertyId, t.target],
      foreignColumns: [
        officialRegistrationSettings.tenantId,
        officialRegistrationSettings.propertyId,
        officialRegistrationSettings.target,
      ],
    }).onDelete("restrict"),
    check("official_registrations_target_valid", oneOf(t.target, OFFICIAL_REGISTRATION_TARGETS)),
    check(
      "official_registrations_reservation_provider_valid",
      oneOf(t.reservationProvider, RESERVATION_PROVIDERS),
    ),
    check(
      "official_registrations_external_reservation_id_not_blank",
      notBlank(t.externalReservationId, 255),
    ),
    check(
      "official_registrations_our_reference_format",
      sql`${t.ourReference} = 'up-' || ${t.registrationId}::text`,
    ),
    check("official_registrations_stage_valid", oneOf(t.stage, REMOTE_STAGES)),
    check(
      "official_registrations_transmission_valid",
      oneOf(t.transmission, TRANSMISSION_STATUSES),
    ),
    check("official_registrations_external_reference_length", maxLength(t.externalReference, 255)),
    check(
      "official_registrations_confirmed_has_reference",
      sql`${t.transmission} <> 'confirmed' OR ${t.externalReference} IS NOT NULL`,
    ),
    check(
      "official_registrations_staff_reason",
      sql`(${t.transmission} IN ('manual', 'failed')) = (${t.manualReason} IS NOT NULL)`,
    ),
    check(
      "official_registrations_error_code_valid",
      sql`${t.lastErrorCode} IS NULL OR ${oneOf(t.lastErrorCode, OFFICIAL_ERROR_CODES)}`,
    ),
    check(
      "official_registrations_manual_reason_valid",
      sql`${t.manualReason} IS NULL OR ${oneOf(t.manualReason, MANUAL_REASONS)}`,
    ),
    check(
      "official_registrations_accepted_consistent",
      sql`(${t.acceptedFingerprint} IS NULL AND ${t.acceptedGuestFingerprint} IS NULL AND ${t.acceptedArrivalDate} IS NULL AND ${t.acceptedDepartureDate} IS NULL)
        OR (${isSha256Hex(t.acceptedFingerprint)} AND ${isSha256Hex(t.acceptedGuestFingerprint)} AND ${t.acceptedDepartureDate} > ${t.acceptedArrivalDate})`,
    ),
    check(
      "official_registrations_unresolved_consistent",
      sql`(${t.unresolvedOperation} IS NULL AND ${t.unresolvedIdempotencyKey} IS NULL AND ${t.unresolvedFingerprint} IS NULL AND ${t.unresolvedGuestFingerprint} IS NULL AND ${t.unresolvedArrivalDate} IS NULL AND ${t.unresolvedDepartureDate} IS NULL AND ${t.unresolvedAt} IS NULL)
        OR (${t.unresolvedOperation} IN (${sqlList(CREATING_OPERATIONS)}) AND ${isSha256Hex(t.unresolvedIdempotencyKey)} AND ${isSha256Hex(t.unresolvedFingerprint)} AND ${isSha256Hex(t.unresolvedGuestFingerprint)} AND ${t.unresolvedDepartureDate} > ${t.unresolvedArrivalDate} AND ${t.unresolvedAt} IS NOT NULL)`,
    ),
    check("official_registrations_attempts_range", sql`${t.attempts} >= 0`),
    check("official_registrations_version_positive", sql`${t.version} > 0`),
  ],
).enableRLS();

export const officialGuestCards = pgTable(
  "official_guest_cards",
  {
    tenantId: text("tenant_id").notNull(),
    officialRegistrationId: uuid("official_registration_id").notNull(),
    status: text("status", { enum: GUEST_CARD_STATUSES }).notNull(),
    deliveryChannel: text("delivery_channel", { enum: GUEST_CARD_DELIVERY_CHANNELS }),
    /** Reference of the card at the target, if it reports one (no link, no code). */
    externalCardReference: text("external_card_reference"),
    cardCount: integer("card_count"),
    lastErrorCode: text("last_error_code", { enum: OFFICIAL_ERROR_CODES }),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull(),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    primaryKey({
      name: "official_guest_cards_pkey",
      columns: [t.tenantId, t.officialRegistrationId],
    }),
    foreignKey({
      name: "official_guest_cards_registration_fkey",
      columns: [t.tenantId, t.officialRegistrationId],
      foreignColumns: [officialRegistrations.tenantId, officialRegistrations.id],
    }).onDelete("restrict"),
    check("official_guest_cards_status_valid", oneOf(t.status, GUEST_CARD_STATUSES)),
    check(
      "official_guest_cards_channel_valid",
      sql`${t.deliveryChannel} IS NULL OR ${oneOf(t.deliveryChannel, GUEST_CARD_DELIVERY_CHANNELS)}`,
    ),
    check("official_guest_cards_reference_length", maxLength(t.externalCardReference, 255)),
    check(
      "official_guest_cards_card_count",
      sql`${t.cardCount} IS NULL OR ${t.cardCount} BETWEEN 1 AND ${sql.raw(String(MAX_TRAVELLERS))}`,
    ),
    check(
      "official_guest_cards_error_code_valid",
      sql`${t.lastErrorCode} IS NULL OR ${oneOf(t.lastErrorCode, OFFICIAL_ERROR_CODES)}`,
    ),
    check("official_guest_cards_version_positive", sql`${t.version} > 0`),
  ],
).enableRLS();

export const officialRegistrationEvents = pgTable(
  "official_registration_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    propertyId: text("property_id").notNull(),
    target: text("target", { enum: OFFICIAL_REGISTRATION_TARGETS }).notNull(),
    officialRegistrationId: uuid("official_registration_id").notNull(),
    operation: text("operation", { enum: OFFICIAL_EVENT_OPERATIONS }).notNull(),
    result: text("result", { enum: OFFICIAL_EVENT_RESULTS }).notNull(),
    code: text("code", { enum: OFFICIAL_ERROR_CODES }),
    attempt: integer("attempt"),
    idempotencyKey: text("idempotency_key"),
    manualReason: text("manual_reason", { enum: MANUAL_REASONS }),
    actor: text("actor", { enum: OFFICIAL_EVENT_ACTORS }).notNull(),
    adminUserId: uuid("admin_user_id"),
    stageAfter: text("stage_after", { enum: REMOTE_STAGES }).notNull(),
    transmissionAfter: text("transmission_after", { enum: TRANSMISSION_STATUSES }).notNull(),
    guestCardAfter: text("guest_card_after", { enum: GUEST_CARD_STATUSES }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /** Retention: may be purged after this instant (only by the purge job, see 0014). */
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "official_registration_events_registration_fkey",
      columns: [t.tenantId, t.officialRegistrationId],
      foreignColumns: [officialRegistrations.tenantId, officialRegistrations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "official_registration_events_admin_fkey",
      columns: [t.tenantId, t.adminUserId],
      foreignColumns: [adminUsers.tenantId, adminUsers.id],
    }).onDelete("restrict"),
    index("official_registration_events_registration_idx").on(
      t.tenantId,
      t.officialRegistrationId,
      t.occurredAt,
    ),
    index("official_registration_events_purge_idx").on(t.purgeAfter),
    // A creating operation with the same content succeeds at most once per registration.
    uniqueIndex("official_registration_events_one_successful_create")
      .on(t.officialRegistrationId, t.idempotencyKey)
      .where(
        sql`${t.result} = 'ok' AND ${t.idempotencyKey} IS NOT NULL AND ${t.operation} IN (${sqlList(CREATING_OPERATIONS)})`,
      ),
    check(
      "official_registration_events_target_valid",
      oneOf(t.target, OFFICIAL_REGISTRATION_TARGETS),
    ),
    check(
      "official_registration_events_operation_valid",
      oneOf(t.operation, OFFICIAL_EVENT_OPERATIONS),
    ),
    check("official_registration_events_result_valid", oneOf(t.result, OFFICIAL_EVENT_RESULTS)),
    check(
      "official_registration_events_code_valid",
      sql`${t.code} IS NULL OR ${oneOf(t.code, OFFICIAL_ERROR_CODES)}`,
    ),
    check(
      "official_registration_events_manual_reason_valid",
      sql`${t.manualReason} IS NULL OR ${oneOf(t.manualReason, MANUAL_REASONS)}`,
    ),
    check("official_registration_events_actor_valid", oneOf(t.actor, OFFICIAL_EVENT_ACTORS)),
    check(
      "official_registration_events_admin_consistent",
      sql`(${t.actor} = 'admin') = (${t.adminUserId} IS NOT NULL)`,
    ),
    check(
      "official_registration_events_idempotency_key_format",
      sql`${t.idempotencyKey} IS NULL OR ${isSha256Hex(t.idempotencyKey)}`,
    ),
    check(
      "official_registration_events_attempt_range",
      sql`${t.attempt} IS NULL OR ${t.attempt} >= 1`,
    ),
    check("official_registration_events_stage_valid", oneOf(t.stageAfter, REMOTE_STAGES)),
    check(
      "official_registration_events_transmission_valid",
      oneOf(t.transmissionAfter, TRANSMISSION_STATUSES),
    ),
    check(
      "official_registration_events_guest_card_valid",
      sql`${t.guestCardAfter} IS NULL OR ${oneOf(t.guestCardAfter, GUEST_CARD_STATUSES)}`,
    ),
  ],
).enableRLS();

/* ------------------------------------------------------------------------------------------
 * Extras migration M1 (docs/concepts/extras-migration.md) – roles, service settings,
 * bookings, stay extensions, Apaleo writes, audit, notifications and import runs.
 *
 * - No guest names, e-mail addresses or free texts from guests in any of these tables:
 *   reservation ids, service ids, amounts, dates and states only.
 * - Apaleo writes run exclusively through `apaleo_write_operations` (idempotency key, lock,
 *   status) – and only while `tenant_service_settings.service_writer = 'stay'`, which is
 *   'extras' until the joint go-live (M1-E; the switch is prepared, not active).
 * - admin_audit_events is append-only (triggers in migration 0018).
 * ---------------------------------------------------------------------------------------- */

/** Properties of an admin with property_scope 'selected'. */
export const adminUserProperties = pgTable(
  "admin_user_properties",
  {
    tenantId: text("tenant_id").notNull(),
    adminUserId: uuid("admin_user_id").notNull(),
    propertyId: text("property_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "admin_user_properties_pkey", columns: [t.adminUserId, t.propertyId] }),
    foreignKey({
      name: "admin_user_properties_admin_user_fkey",
      columns: [t.tenantId, t.adminUserId],
      foreignColumns: [adminUsers.tenantId, adminUsers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "admin_user_properties_property_fkey",
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete("cascade"),
    index("admin_user_properties_property_idx").on(t.tenantId, t.propertyId),
  ],
).enableRLS();

/**
 * Invitations to the STAY admin. Only the SHA-256 of the one-time token is stored; the link
 * is shown once to the inviting admin. No passwords are ever migrated from the Extras app.
 */
export const adminInvitations = pgTable(
  "admin_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    role: text("role", { enum: ADMIN_ROLES }).notNull(),
    propertyScope: text("property_scope", { enum: PROPERTY_SCOPES }).notNull().default("all"),
    /** Property ids for scope 'selected' (validated against properties when accepting). */
    propertyIds: text("property_ids").array().notNull().default([]),
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedUserId: uuid("accepted_user_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** extras = generated from the Extras user list by the import (no password). */
    source: text("source", { enum: RECORD_SOURCES }).notNull().default("stay"),
    ...timestamps,
  },
  (t) => [
    unique("admin_invitations_token_hash_key").on(t.tokenHash),
    unique("admin_invitations_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("admin_invitations_open_email_idx")
      .on(t.tenantId, t.email)
      .where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    foreignKey({
      name: "admin_invitations_invited_by_fkey",
      columns: [t.tenantId, t.invitedBy],
      foreignColumns: [adminUsers.tenantId, adminUsers.id],
    }).onDelete("set null"),
    foreignKey({
      name: "admin_invitations_accepted_user_fkey",
      columns: [t.tenantId, t.acceptedUserId],
      foreignColumns: [adminUsers.tenantId, adminUsers.id],
    }).onDelete("set null"),
    check("admin_invitations_token_hash_format", isSha256Hex(t.tokenHash)),
    check(
      "admin_invitations_email_format",
      sql`${t.email} = lower(${t.email}) AND char_length(${t.email}) BETWEEN 3 AND 254 AND position('@' in ${t.email}) > 1`,
    ),
    check("admin_invitations_role_valid", oneOf(t.role, ADMIN_ROLES)),
    check("admin_invitations_scope_valid", oneOf(t.propertyScope, PROPERTY_SCOPES)),
    check("admin_invitations_source_valid", oneOf(t.source, RECORD_SOURCES)),
    check(
      "admin_invitations_scope_shape",
      sql`(${t.propertyScope} = 'all' AND cardinality(${t.propertyIds}) = 0)
        OR (${t.propertyScope} = 'selected' AND ${t.role} <> 'owner'
          AND cardinality(${t.propertyIds}) BETWEEN 1 AND 100)`,
    ),
    check(
      "admin_invitations_not_accepted_and_revoked",
      sql`${t.acceptedAt} IS NULL OR ${t.revokedAt} IS NULL`,
    ),
    check("admin_invitations_expiry_after_creation", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
).enableRLS();

/**
 * Service settings per property (Extras "Verlängerungsnächte" config and Slack routing).
 * A property without a row uses DEFAULT_STAY_EXTENSION_SETTINGS (extension switched off).
 */
export const propertyServiceSettings = pgTable(
  "property_service_settings",
  {
    tenantId: text("tenant_id").notNull(),
    propertyId: text("property_id").notNull(),
    extensionNightEnabled: boolean("extension_night_enabled").notNull().default(false),
    /** Discounts in percent (0–90) per phase and gap. */
    discountPreArrivalOneNightGap: integer("discount_pre_arrival_one_night_gap")
      .notNull()
      .default(15),
    discountPreArrivalStandard: integer("discount_pre_arrival_standard").notNull().default(10),
    discountInHouseOneNightGap: integer("discount_in_house_one_night_gap").notNull().default(20),
    discountInHouseStandard: integer("discount_in_house_standard").notNull().default(15),
    minSellableStayNights: integer("min_sellable_stay_nights").notNull().default(2),
    /** Name of the Slack route (resolved to a webhook from the environment – never stored). */
    slackRoute: text("slack_route"),
    /** M4: also post a status message when a request is confirmed or declined. */
    slackDecisionUpdates: boolean("slack_decision_updates").notNull().default(false),
    importedHash: text("imported_hash"),
    importedAt: timestamp("imported_at", { withTimezone: true }),
    updatedBy: uuid("updated_by"),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "property_service_settings_pkey", columns: [t.tenantId, t.propertyId] }),
    foreignKey({
      name: "property_service_settings_property_fkey",
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "property_service_settings_updated_by_fkey",
      columns: [t.tenantId, t.updatedBy],
      foreignColumns: [adminUsers.tenantId, adminUsers.id],
    }).onDelete("set null"),
    check(
      "property_service_settings_discounts_valid",
      sql`${t.discountPreArrivalOneNightGap} BETWEEN 0 AND 90 AND ${t.discountPreArrivalStandard} BETWEEN 0 AND 90
        AND ${t.discountInHouseOneNightGap} BETWEEN 0 AND 90 AND ${t.discountInHouseStandard} BETWEEN 0 AND 90`,
    ),
    check(
      "property_service_settings_min_nights_valid",
      sql`${t.minSellableStayNights} BETWEEN 1 AND 30`,
    ),
    check(
      "property_service_settings_slack_route_valid",
      sql`${t.slackRoute} IS NULL OR ${t.slackRoute} ~ '^[a-z0-9-]{1,40}$'`,
    ),
    check(
      "property_service_settings_imported_hash_valid",
      sql`${t.importedHash} IS NULL OR ${isSha256Hex(t.importedHash)}`,
    ),
  ],
).enableRLS();

/** Which system may write services to Apaleo for a tenant. Exactly one, never both. */
export const SERVICE_WRITERS = ["extras", "stay"] as const;
/**
 * Joint go-live states (M1-E): extras_active → syncing → extras_locked → stay_active,
 * fallback via extras_locked → extras_active. Changed only by owners (`writer.switch`).
 */
export const GO_LIVE_STATES = ["extras_active", "syncing", "extras_locked", "stay_active"] as const;

export const tenantServiceSettings = pgTable(
  "tenant_service_settings",
  {
    tenantId: text("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "restrict" }),
    serviceWriter: text("service_writer", { enum: SERVICE_WRITERS }).notNull().default("extras"),
    goLiveState: text("go_live_state", { enum: GO_LIVE_STATES }).notNull().default("extras_active"),
    changedAt: timestamp("changed_at", { withTimezone: true }),
    changedBy: uuid("changed_by"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "tenant_service_settings_changed_by_fkey",
      columns: [t.tenantId, t.changedBy],
      foreignColumns: [adminUsers.tenantId, adminUsers.id],
    }).onDelete("set null"),
    check("tenant_service_settings_writer_valid", oneOf(t.serviceWriter, SERVICE_WRITERS)),
    check("tenant_service_settings_state_valid", oneOf(t.goLiveState, GO_LIVE_STATES)),
    // STAY writes only in state stay_active, and stay_active always means STAY writes.
    check(
      "tenant_service_settings_writer_matches_state",
      sql`(${t.serviceWriter} = 'stay') = (${t.goLiveState} = 'stay_active')`,
    ),
  ],
).enableRLS();

/**
 * Bookings of own services ("Bestellungen"): one row per guest order, items below. Status of
 * the order as a whole: completed (all items booked), partial, failed.
 */
export const SERVICE_BOOKING_STATUSES = ["processing", "completed", "partial", "failed"] as const;
export const SERVICE_BOOKING_ITEM_STATUSES = ["pending", "booked", "failed", "skipped"] as const;

export const serviceBookings = pgTable(
  "service_bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    propertyId: text("property_id").notNull(),
    reservationProvider: text("reservation_provider", { enum: RESERVATION_PROVIDERS }).notNull(),
    externalReservationId: text("external_reservation_id").notNull(),
    externalBookingId: text("external_booking_id"),
    status: text("status", { enum: SERVICE_BOOKING_STATUSES }).notNull().default("processing"),
    /** Client idempotency key of the guest submit (double click, retries). */
    idempotencyKey: text("idempotency_key"),
    totalCents: integer("total_cents"),
    currency: text("currency"),
    source: text("source", { enum: RECORD_SOURCES }).notNull().default("stay"),
    legacyId: text("legacy_id"),
    slackNotifiedAt: timestamp("slack_notified_at", { withTimezone: true }),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("service_bookings_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("service_bookings_legacy_id_idx").on(t.tenantId, t.legacyId),
    uniqueIndex("service_bookings_idempotency_idx").on(t.tenantId, t.idempotencyKey),
    foreignKey({
      name: "service_bookings_property_fkey",
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete("restrict"),
    index("service_bookings_reservation_idx").on(
      t.tenantId,
      t.reservationProvider,
      t.externalReservationId,
    ),
    index("service_bookings_property_created_idx").on(t.tenantId, t.propertyId, t.createdAt),
    index("service_bookings_purge_idx").on(t.purgeAfter),
    check("service_bookings_status_valid", oneOf(t.status, SERVICE_BOOKING_STATUSES)),
    check("service_bookings_source_valid", oneOf(t.source, RECORD_SOURCES)),
    check(
      "service_bookings_reservation_provider_valid",
      oneOf(t.reservationProvider, RESERVATION_PROVIDERS),
    ),
    check(
      "service_bookings_values_valid",
      sql`char_length(${t.externalReservationId}) BETWEEN 1 AND 100
        AND (${t.externalBookingId} IS NULL OR char_length(${t.externalBookingId}) BETWEEN 1 AND 100)
        AND (${t.idempotencyKey} IS NULL OR ${t.idempotencyKey} ~ '^[A-Za-z0-9_:.-]{8,200}$')
        AND (${t.legacyId} IS NULL OR char_length(${t.legacyId}) BETWEEN 1 AND 100)
        AND (${t.totalCents} IS NULL OR ${t.totalCents} >= 0)
        AND (${t.currency} IS NULL OR ${t.currency} ~ '^[A-Z]{3}$')`,
    ),
  ],
).enableRLS();

export const serviceBookingItems = pgTable(
  "service_booking_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    bookingId: uuid("booking_id").notNull(),
    /** Catalog entry (null for imported history whose service no longer exists). */
    offerId: uuid("offer_id"),
    apaleoServiceId: text("apaleo_service_id").notNull(),
    /** Name at booking time (snapshot for history; service names, never guest data). */
    displayName: text("display_name").notNull(),
    actionType: text("action_type", { enum: SERVICE_ACTION_TYPES }).notNull().default("service"),
    quantity: integer("quantity").notNull().default(1),
    serviceDates: date("service_dates").array().notNull().default([]),
    amountCents: integer("amount_cents"),
    currency: text("currency"),
    status: text("status", { enum: SERVICE_BOOKING_ITEM_STATUSES }).notNull().default("pending"),
    /** Stable error code only (e.g. no_availability) – never raw provider responses. */
    errorCode: text("error_code"),
    writeOperationId: uuid("write_operation_id"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "service_booking_items_booking_fkey",
      columns: [t.tenantId, t.bookingId],
      foreignColumns: [serviceBookings.tenantId, serviceBookings.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "service_booking_items_offer_fkey",
      columns: [t.tenantId, t.offerId],
      foreignColumns: [offers.tenantId, offers.id],
    }).onDelete("set null"),
    index("service_booking_items_booking_idx").on(t.tenantId, t.bookingId),
    check("service_booking_items_status_valid", oneOf(t.status, SERVICE_BOOKING_ITEM_STATUSES)),
    check("service_booking_items_action_type_valid", oneOf(t.actionType, SERVICE_ACTION_TYPES)),
    check(
      "service_booking_items_values_valid",
      sql`${t.apaleoServiceId} ~ '^[A-Za-z0-9_-]{1,120}$'
        AND char_length(btrim(${t.displayName})) BETWEEN 1 AND 200
        AND ${t.quantity} BETWEEN 1 AND 50
        AND cardinality(${t.serviceDates}) <= 400
        AND (${t.amountCents} IS NULL OR ${t.amountCents} >= 0)
        AND (${t.currency} IS NULL OR ${t.currency} ~ '^[A-Z]{3}$')
        AND (${t.errorCode} IS NULL OR ${t.errorCode} ~ '^[a-z0-9_]{1,60}$')`,
    ),
  ],
).enableRLS();

/** Stay extensions ("Eine Nacht länger"): the audit result of each extension, as in Extras. */
export const STAY_EXTENSION_STATUSES = [
  "processing",
  "confirmed",
  "confirmed_with_issues",
  "failed",
] as const;
export const STAY_EXTENSION_PHASES = ["pre_arrival", "in_house"] as const;

export const stayExtensions = pgTable(
  "stay_extensions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    propertyId: text("property_id").notNull(),
    reservationProvider: text("reservation_provider", { enum: RESERVATION_PROVIDERS }).notNull(),
    externalReservationId: text("external_reservation_id").notNull(),
    oldDeparture: date("old_departure").notNull(),
    newDeparture: date("new_departure").notNull(),
    newDepartureConfirmed: boolean("new_departure_confirmed").notNull().default(false),
    phase: text("phase", { enum: STAY_EXTENSION_PHASES }),
    gap: integer("gap"),
    averageNightlyRateCents: integer("average_nightly_rate_cents"),
    discountPercent: integer("discount_percent"),
    extensionPriceCents: integer("extension_price_cents"),
    totalAdditionalCents: integer("total_additional_cents"),
    currency: text("currency"),
    /** Details of extended services, late check-out moves and city tax (ids/amounts only). */
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    mandatoryServicesIntact: boolean("mandatory_services_intact"),
    status: text("status", { enum: STAY_EXTENSION_STATUSES }).notNull().default("processing"),
    source: text("source", { enum: RECORD_SOURCES }).notNull().default("stay"),
    legacyId: text("legacy_id"),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("stay_extensions_legacy_id_idx").on(t.tenantId, t.legacyId),
    foreignKey({
      name: "stay_extensions_property_fkey",
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete("restrict"),
    index("stay_extensions_reservation_idx").on(
      t.tenantId,
      t.reservationProvider,
      t.externalReservationId,
    ),
    index("stay_extensions_property_created_idx").on(t.tenantId, t.propertyId, t.createdAt),
    check("stay_extensions_status_valid", oneOf(t.status, STAY_EXTENSION_STATUSES)),
    check(
      "stay_extensions_phase_valid",
      sql`${t.phase} IS NULL OR ${oneOf(t.phase, STAY_EXTENSION_PHASES)}`,
    ),
    check("stay_extensions_source_valid", oneOf(t.source, RECORD_SOURCES)),
    check(
      "stay_extensions_reservation_provider_valid",
      oneOf(t.reservationProvider, RESERVATION_PROVIDERS),
    ),
    check("stay_extensions_dates_valid", sql`${t.newDeparture} > ${t.oldDeparture}`),
    check(
      "stay_extensions_values_valid",
      sql`(${t.gap} IS NULL OR ${t.gap} BETWEEN 0 AND 365)
        AND (${t.discountPercent} IS NULL OR ${t.discountPercent} BETWEEN 0 AND 90)
        AND (${t.averageNightlyRateCents} IS NULL OR ${t.averageNightlyRateCents} >= 0)
        AND (${t.extensionPriceCents} IS NULL OR ${t.extensionPriceCents} >= 0)
        AND (${t.totalAdditionalCents} IS NULL OR ${t.totalAdditionalCents} >= 0)
        AND (${t.currency} IS NULL OR ${t.currency} ~ '^[A-Z]{3}$')
        AND (${t.legacyId} IS NULL OR char_length(${t.legacyId}) BETWEEN 1 AND 100)
        AND jsonb_typeof(${t.details}) = 'object'`,
    ),
  ],
).enableRLS();

/**
 * The central Apaleo write log (M1-C): every write STAY would send to Apaleo is first
 * reserved here under a unique idempotency key. `blocked` = refused by policy (writes
 * disabled, writer is Extras, property not allowed, reservation of another property).
 */
export const APALEO_WRITE_OPERATIONS = [
  "book-service",
  "amend-occupancy",
  "amend-stay",
  "move-service",
  "update-vehicle",
  "append-comment",
] as const;
export const APALEO_WRITE_STATUSES = [
  "pending",
  "blocked",
  "simulated",
  "succeeded",
  "failed",
] as const;
export const APALEO_WRITE_TRIGGERS = ["guest", "admin", "system"] as const;

export const apaleoWriteOperations = pgTable(
  "apaleo_write_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    propertyId: text("property_id").notNull(),
    externalReservationId: text("external_reservation_id").notNull(),
    operation: text("operation", { enum: APALEO_WRITE_OPERATIONS }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    /** SHA-256 of the canonical request – a retry with the same key must carry the same payload. */
    requestHash: text("request_hash").notNull(),
    status: text("status", { enum: APALEO_WRITE_STATUSES }).notNull().default("pending"),
    trigger: text("trigger", { enum: APALEO_WRITE_TRIGGERS }).notNull(),
    actorAdminId: uuid("actor_admin_id"),
    /** Stable code (policy or mapped provider error) – never raw responses or personal data. */
    resultCode: text("result_code"),
    httpStatus: integer("http_status"),
    attempts: integer("attempts").notNull().default(0),
    /** Lock: a pending row older than this may be taken over by a retry. */
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("apaleo_write_operations_tenant_id_id_key").on(t.tenantId, t.id),
    unique("apaleo_write_operations_idempotency_key").on(t.tenantId, t.idempotencyKey),
    foreignKey({
      name: "apaleo_write_operations_property_fkey",
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "apaleo_write_operations_actor_fkey",
      columns: [t.tenantId, t.actorAdminId],
      foreignColumns: [adminUsers.tenantId, adminUsers.id],
    }).onDelete("set null"),
    index("apaleo_write_operations_reservation_idx").on(
      t.tenantId,
      t.externalReservationId,
      t.createdAt,
    ),
    index("apaleo_write_operations_status_idx").on(t.status, t.createdAt),
    check("apaleo_write_operations_operation_valid", oneOf(t.operation, APALEO_WRITE_OPERATIONS)),
    check("apaleo_write_operations_status_valid", oneOf(t.status, APALEO_WRITE_STATUSES)),
    check("apaleo_write_operations_trigger_valid", oneOf(t.trigger, APALEO_WRITE_TRIGGERS)),
    check("apaleo_write_operations_request_hash_valid", isSha256Hex(t.requestHash)),
    check(
      "apaleo_write_operations_values_valid",
      sql`${t.idempotencyKey} ~ '^[A-Za-z0-9_:.-]{8,200}$'
        AND char_length(${t.externalReservationId}) BETWEEN 1 AND 100
        AND (${t.resultCode} IS NULL OR ${t.resultCode} ~ '^[a-z0-9_]{1,60}$')
        AND (${t.httpStatus} IS NULL OR ${t.httpStatus} BETWEEN 100 AND 599)
        AND ${t.attempts} BETWEEN 0 AND 20`,
    ),
    check(
      "apaleo_write_operations_completion",
      sql`(${t.status} IN ('pending') AND ${t.completedAt} IS NULL)
        OR (${t.status} <> 'pending' AND ${t.completedAt} IS NOT NULL)`,
    ),
  ],
).enableRLS();

/**
 * Short-lived exclusive claims of the STAY booking engine (M3) – the counterpart of the Extras
 * Redis claims (claimDogBooking, claimVehicleBooking, claimOccupancyAmendment, claimStayExtension,
 * claimRequestProcessing, claimRequestBooking). A claim is free once `expires_at` has passed.
 */
export const serviceLocks = pgTable(
  "service_locks",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    lockKey: text("lock_key").notNull(),
    holder: text("holder").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "service_locks_pkey", columns: [t.tenantId, t.lockKey] }),
    index("service_locks_expires_idx").on(t.expiresAt),
    check(
      "service_locks_values_valid",
      sql`${t.lockKey} ~ '^[A-Za-z0-9_:.-]{1,200}$' AND char_length(${t.holder}) BETWEEN 1 AND 100`,
    ),
  ],
).enableRLS();

/**
 * Append-only audit log of admin actions and service events (UPDATE/DELETE/TRUNCATE rejected
 * by triggers, migration 0018). `details` holds ids, states and changed field names only.
 */
export const ADMIN_AUDIT_ACTORS = ["admin", "guest", "system", "import"] as const;

export const adminAuditEvents = pgTable(
  "admin_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    propertyId: text("property_id"),
    actorType: text("actor_type", { enum: ADMIN_AUDIT_ACTORS }).notNull(),
    /** Admin user id (no FK: audit rows outlive deleted users). */
    actorAdminId: uuid("actor_admin_id"),
    /** e.g. "user.role_changed", "request.approved", "catalog.updated", "writer.switched". */
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("admin_audit_events_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("admin_audit_events_entity_idx").on(t.tenantId, t.entityType, t.entityId),
    check("admin_audit_events_actor_valid", oneOf(t.actorType, ADMIN_AUDIT_ACTORS)),
    check(
      "admin_audit_events_values_valid",
      sql`${t.action} ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$' AND char_length(${t.action}) <= 80
        AND ${t.entityType} ~ '^[a-z][a-z0-9_]{0,40}$'
        AND (${t.entityId} IS NULL OR char_length(${t.entityId}) BETWEEN 1 AND 200)
        AND (${t.propertyId} IS NULL OR ${isKey(t.propertyId)})
        AND jsonb_typeof(${t.details}) = 'object' AND pg_column_size(${t.details}) <= 8192`,
    ),
  ],
).enableRLS();

/**
 * Outbox for notifications (Slack to the front office, guest notifications later). A job is
 * only sent by a worker when its channel is enabled; guest channels stay disabled (M1).
 */
export const NOTIFICATION_CHANNELS = ["slack", "guest-email", "guest-push"] as const;
export const NOTIFICATION_STATUSES = [
  "pending",
  "sending",
  "sent",
  "failed",
  "suppressed",
] as const;

export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    propertyId: text("property_id"),
    channel: text("channel", { enum: NOTIFICATION_CHANNELS }).notNull(),
    /** e.g. "order.created", "request.created", "extension.confirmed". */
    template: text("template").notNull(),
    /** Unique per tenant: one notification per event, also across retries. */
    dedupKey: text("dedup_key").notNull(),
    /** Template data: ids, service names, dates, amounts – rendered at send time. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status", { enum: NOTIFICATION_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastErrorCode: text("last_error_code"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** M4: how a sent notification was delivered – "simulated" until Slack is approved. */
    deliveryMode: text("delivery_mode"),
    ...timestamps,
  },
  (t) => [
    unique("notification_outbox_dedup_key").on(t.tenantId, t.dedupKey),
    index("notification_outbox_due_idx").on(t.status, t.nextAttemptAt),
    check("notification_outbox_channel_valid", oneOf(t.channel, NOTIFICATION_CHANNELS)),
    check("notification_outbox_status_valid", oneOf(t.status, NOTIFICATION_STATUSES)),
    check(
      "notification_outbox_values_valid",
      sql`${t.template} ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$' AND char_length(${t.template}) <= 80
        AND ${t.dedupKey} ~ '^[A-Za-z0-9_:.-]{1,200}$'
        AND ${t.attempts} BETWEEN 0 AND 50
        AND (${t.lastErrorCode} IS NULL OR ${t.lastErrorCode} ~ '^[a-z0-9_]{1,60}$')
        AND (${t.propertyId} IS NULL OR ${isKey(t.propertyId)})
        AND jsonb_typeof(${t.payload}) = 'object' AND pg_column_size(${t.payload}) <= 16384
        AND ((${t.status} = 'sent') = (${t.sentAt} IS NOT NULL))
        AND (${t.deliveryMode} IS NULL OR ${t.deliveryMode} IN ('simulated', 'live'))`,
    ),
  ],
).enableRLS();

/** Import runs from the Extras export (dry run or apply) with their per-record results. */
export const MIGRATION_RUN_MODES = ["dry-run", "apply"] as const;
export const MIGRATION_RUN_STATUSES = ["running", "completed", "failed"] as const;
export const MIGRATION_ITEM_ACTIONS = [
  "create",
  "update",
  "unchanged",
  "conflict",
  "skip",
  "error",
] as const;

export const migrationRuns = pgTable(
  "migration_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    mode: text("mode", { enum: MIGRATION_RUN_MODES }).notNull(),
    status: text("status", { enum: MIGRATION_RUN_STATUSES }).notNull().default("running"),
    /** SHA-256 of the export manifest the run was based on. */
    snapshotSha256: text("snapshot_sha256").notNull(),
    startedBy: uuid("started_by"),
    /** Counts per entity and action – no record contents. */
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    unique("migration_runs_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "migration_runs_started_by_fkey",
      columns: [t.tenantId, t.startedBy],
      foreignColumns: [adminUsers.tenantId, adminUsers.id],
    }).onDelete("set null"),
    index("migration_runs_tenant_started_idx").on(t.tenantId, t.startedAt),
    check("migration_runs_mode_valid", oneOf(t.mode, MIGRATION_RUN_MODES)),
    check("migration_runs_status_valid", oneOf(t.status, MIGRATION_RUN_STATUSES)),
    check("migration_runs_snapshot_valid", isSha256Hex(t.snapshotSha256)),
    check("migration_runs_finished", sql`(${t.status} = 'running') = (${t.finishedAt} IS NULL)`),
  ],
).enableRLS();

export const migrationItems = pgTable(
  "migration_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    runId: uuid("run_id").notNull(),
    /** e.g. "catalog_item", "property_settings", "order", "request", "extension", "user". */
    entityType: text("entity_type").notNull(),
    /** Stable source key (e.g. "ALTUS:SVC-1"), never a name or e-mail address. */
    sourceKey: text("source_key").notNull(),
    sourceHash: text("source_hash").notNull(),
    action: text("action", { enum: MIGRATION_ITEM_ACTIONS }).notNull(),
    targetId: text("target_id"),
    /** Stable reason code for conflict/skip/error. */
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "migration_items_run_fkey",
      columns: [t.tenantId, t.runId],
      foreignColumns: [migrationRuns.tenantId, migrationRuns.id],
    }).onDelete("cascade"),
    unique("migration_items_run_source_key").on(t.runId, t.entityType, t.sourceKey),
    check("migration_items_action_valid", oneOf(t.action, MIGRATION_ITEM_ACTIONS)),
    check("migration_items_source_hash_valid", isSha256Hex(t.sourceHash)),
    check(
      "migration_items_values_valid",
      sql`${t.entityType} ~ '^[a-z][a-z0-9_]{0,40}$'
        AND char_length(${t.sourceKey}) BETWEEN 1 AND 200 AND ${t.sourceKey} !~ '@'
        AND (${t.targetId} IS NULL OR char_length(${t.targetId}) BETWEEN 1 AND 200)
        AND (${t.reason} IS NULL OR ${t.reason} ~ '^[a-z0-9_]{1,60}$')`,
    ),
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
  guestRegistrationContacts,
  guestRegistrationBilling,
  partners,
  offers,
  offerProperties,
  offerMetricsDaily,
  offerRequests,
  contactVerificationChallenges,
  contactVerificationEvents,
  guestRegistrationSyncs,
  unitAccessCodes,
  paymentRequests,
  reservationPaymentStates,
  paymentAuditEvents,
  officialRegistrationSettings,
  officialRegistrations,
  officialGuestCards,
  officialRegistrationEvents,
  adminUserProperties,
  adminInvitations,
  propertyServiceSettings,
  tenantServiceSettings,
  serviceBookings,
  serviceBookingItems,
  stayExtensions,
  apaleoWriteOperations,
  adminAuditEvents,
  notificationOutbox,
  migrationRuns,
  migrationItems,
};
