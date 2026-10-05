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
  ENTITY_KEY_PATTERN,
  EXTERNAL_ENTITY_TYPES,
  EXTERNAL_PROVIDERS,
  RESERVATION_PROVIDERS,
} from "@up/core";
import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  integer,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
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

export const schema = {
  tenants,
  properties,
  units,
  externalMappings,
  guestAccess,
  guestSessions,
  rateLimitBuckets,
};
