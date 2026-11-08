/**
 * Service catalog administration (M2): central offers (own services) and their configuration
 * per property. Authorization (`catalog.*`) happens in the admin app; this module enforces
 * tenant isolation, writes `updated_by`/`updated_at` (the import's conflict detection relies
 * on them) and records every change in the audit log in the same transaction.
 */
import {
  type CancellationPolicy,
  type ContentImage,
  DEFAULT_AVAILABILITY,
  type GuideStatus,
  isEntityKey,
  type LocalizedText,
  type OfferCategory,
  type TenantContext,
} from "@up/core";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { type Database } from "../client";
import { offerProperties, offers, properties } from "../schema";
import { recordAdminAuditEvent } from "./audit-repository";

function assertTenantContext(context: TenantContext): void {
  if (!isEntityKey(context.tenantId)) throw new TypeError("Invalid tenant context");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CatalogPropertyConfig = {
  propertyId: string;
  extrasServiceId: string | null;
  active: boolean;
  sortOrder: number;
  actionType: "service" | "increase_occupancy" | null;
  bookingRule: "per_stay" | "per_night" | "arrival_day" | "departure_day" | null;
  fulfillment: "instant" | "request" | "link" | null;
  extraPersonPriceCents: number | null;
  currency: string | null;
  priceUnitLabel: LocalizedText | null;
  requiresRemainingCapacity: boolean;
  requiresVehicleRegistration: boolean;
  maxOnePerReservation: boolean;
  allowedUnitGroupIds: string[];
  titleOverride: LocalizedText | null;
  teaserOverride: LocalizedText | null;
  legacyKey: string | null;
  importedAt: Date | null;
  updatedAt: Date;
};

export type CatalogOffer = {
  id: string;
  kind: "house-service" | "partner";
  status: GuideStatus;
  category: OfferCategory;
  title: LocalizedText;
  teaser: LocalizedText;
  body: LocalizedText | null;
  details: LocalizedText | null;
  heroImage: ContentImage | null;
  fulfillment: "instant" | "request" | "link";
  cancellation: CancellationPolicy;
  sortOrder: number;
  legacyKey: string | null;
  updatedAt: Date;
  properties: CatalogPropertyConfig[];
};

function toConfig(row: typeof offerProperties.$inferSelect): CatalogPropertyConfig {
  return {
    propertyId: row.propertyId,
    extrasServiceId: row.extrasServiceId,
    active: row.active,
    sortOrder: row.sortOrder,
    actionType: row.actionType,
    bookingRule: row.bookingRule,
    fulfillment: row.fulfillment,
    extraPersonPriceCents: row.extraPersonPriceCents,
    currency: row.currency,
    priceUnitLabel: row.priceUnitLabel,
    requiresRemainingCapacity: row.requiresRemainingCapacity,
    requiresVehicleRegistration: row.requiresVehicleRegistration,
    maxOnePerReservation: row.maxOnePerReservation,
    allowedUnitGroupIds: [...row.allowedUnitGroupIds],
    titleOverride: row.titleOverride,
    teaserOverride: row.teaserOverride,
    legacyKey: row.legacyKey,
    importedAt: row.importedAt,
    updatedAt: row.updatedAt,
  };
}

function toOffer(row: typeof offers.$inferSelect, configs: CatalogPropertyConfig[]): CatalogOffer {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    category: row.category,
    title: row.title,
    teaser: row.teaser,
    body: row.body,
    details: row.details,
    heroImage: row.heroImage,
    fulfillment: row.fulfillment,
    cancellation: row.cancellation,
    sortOrder: row.sortOrder,
    legacyKey: row.legacyKey,
    updatedAt: row.updatedAt,
    properties: configs.sort((a, b) => a.propertyId.localeCompare(b.propertyId)),
  };
}

/**
 * Own services of the tenant with their property configurations. With `propertyIds` (a
 * property-limited admin) only configurations of those properties are returned, and only
 * offers that have at least one of them.
 */
export async function listCatalogOffers(
  db: Database,
  context: TenantContext,
  options: { propertyIds?: readonly string[] } = {},
): Promise<CatalogOffer[]> {
  assertTenantContext(context);
  const rows = await db
    .select()
    .from(offers)
    .where(and(eq(offers.tenantId, context.tenantId), eq(offers.kind, "house-service")))
    .orderBy(asc(offers.sortOrder), asc(offers.id));
  if (!rows.length) return [];
  const configs = await db
    .select()
    .from(offerProperties)
    .where(
      and(
        eq(offerProperties.tenantId, context.tenantId),
        inArray(
          offerProperties.offerId,
          rows.map((row) => row.id),
        ),
        options.propertyIds
          ? inArray(offerProperties.propertyId, [...options.propertyIds, "-"])
          : undefined,
      ),
    );
  const byOffer = new Map<string, CatalogPropertyConfig[]>();
  for (const config of configs) {
    byOffer.set(config.offerId, [...(byOffer.get(config.offerId) ?? []), toConfig(config)]);
  }
  return rows
    .map((row) => toOffer(row, byOffer.get(row.id) ?? []))
    .filter((offer) => !options.propertyIds || offer.properties.length > 0);
}

export async function getCatalogOffer(
  db: Database,
  context: TenantContext,
  offerId: string,
): Promise<CatalogOffer | undefined> {
  assertTenantContext(context);
  if (!UUID.test(offerId)) return undefined;
  const [row] = await db
    .select()
    .from(offers)
    .where(and(eq(offers.tenantId, context.tenantId), eq(offers.id, offerId)));
  if (!row) return undefined;
  const configs = await db
    .select()
    .from(offerProperties)
    .where(
      and(eq(offerProperties.tenantId, context.tenantId), eq(offerProperties.offerId, offerId)),
    );
  return toOffer(row, configs.map(toConfig));
}

export type CatalogOfferInput = {
  title: LocalizedText;
  teaser: LocalizedText;
  body: LocalizedText | null;
  details: LocalizedText | null;
  category: OfferCategory;
  fulfillment: "instant" | "request";
  cancellation: CancellationPolicy;
  heroImage: ContentImage | null;
  slug: LocalizedText;
};

export async function createCatalogOffer(
  db: Database,
  context: TenantContext,
  input: CatalogOfferInput & { actorAdminId: string },
): Promise<string> {
  assertTenantContext(context);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(offers)
      .values({
        tenantId: context.tenantId,
        kind: "house-service",
        status: "draft",
        category: input.category,
        slug: input.slug,
        title: input.title,
        teaser: input.teaser,
        body: input.body,
        details: input.details,
        heroImage: input.heroImage,
        fulfillment: input.fulfillment,
        cancellation: input.cancellation,
        availability: DEFAULT_AVAILABILITY,
      })
      .returning({ id: offers.id });
    if (!row) throw new Error("offer not created");
    await recordAdminAuditEvent(tx, context, {
      actorType: "admin",
      actorAdminId: input.actorAdminId,
      action: "catalog.offer_created",
      entityType: "offer",
      entityId: row.id,
    });
    return row.id;
  });
}

const OFFER_FIELDS = [
  "title",
  "teaser",
  "body",
  "details",
  "category",
  "fulfillment",
  "cancellation",
  "heroImage",
  "slug",
] as const;

export async function updateCatalogOffer(
  db: Database,
  context: TenantContext,
  offerId: string,
  input: CatalogOfferInput & { actorAdminId: string },
): Promise<boolean> {
  assertTenantContext(context);
  if (!UUID.test(offerId)) return false;
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(offers)
      .where(
        and(
          eq(offers.tenantId, context.tenantId),
          eq(offers.id, offerId),
          eq(offers.kind, "house-service"),
        ),
      )
      .for("update");
    if (!current) return false;
    const changedFields = OFFER_FIELDS.filter(
      (field) => JSON.stringify(current[field] ?? null) !== JSON.stringify(input[field] ?? null),
    );
    if (!changedFields.length) return true;
    await tx
      .update(offers)
      .set({
        title: input.title,
        teaser: input.teaser,
        body: input.body,
        details: input.details,
        category: input.category,
        fulfillment: input.fulfillment,
        cancellation: input.cancellation,
        heroImage: input.heroImage,
        slug: input.slug,
        updatedAt: new Date(),
      })
      .where(and(eq(offers.tenantId, context.tenantId), eq(offers.id, offerId)));
    await recordAdminAuditEvent(tx, context, {
      actorType: "admin",
      actorAdminId: input.actorAdminId,
      action: "catalog.offer_updated",
      entityType: "offer",
      entityId: offerId,
      details: { changedFields },
    });
    return true;
  });
}

export async function setCatalogOfferStatus(
  db: Database,
  context: TenantContext,
  input: { offerId: string; status: GuideStatus; actorAdminId: string; now: Date },
): Promise<boolean> {
  assertTenantContext(context);
  if (!UUID.test(input.offerId)) return false;
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(offers)
      .set({
        status: input.status,
        updatedAt: input.now,
        ...(input.status === "published"
          ? {
              firstPublishedAt: sql`coalesce(${offers.firstPublishedAt}, ${input.now.toISOString()}::timestamptz)`,
            }
          : {}),
      })
      .where(
        and(
          eq(offers.tenantId, context.tenantId),
          eq(offers.id, input.offerId),
          eq(offers.kind, "house-service"),
        ),
      )
      .returning({ id: offers.id });
    if (!rows.length) return false;
    await recordAdminAuditEvent(tx, context, {
      actorType: "admin",
      actorAdminId: input.actorAdminId,
      action: "catalog.offer_status_changed",
      entityType: "offer",
      entityId: input.offerId,
      details: { status: input.status },
    });
    return true;
  });
}

export type PropertyConfigInput = Omit<
  CatalogPropertyConfig,
  "propertyId" | "legacyKey" | "importedAt" | "updatedAt" | "currency"
>;

const CONFIG_FIELDS = [
  "extrasServiceId",
  "active",
  "sortOrder",
  "actionType",
  "bookingRule",
  "fulfillment",
  "extraPersonPriceCents",
  "priceUnitLabel",
  "requiresRemainingCapacity",
  "requiresVehicleRegistration",
  "maxOnePerReservation",
  "allowedUnitGroupIds",
  "titleOverride",
  "teaserOverride",
] as const;

export type ConfigSaveResult =
  { ok: true; created: boolean } | { ok: false; reason: "not-found" | "service-in-use" };

/**
 * Creates or updates the configuration of an offer at one property. The Apaleo service may be
 * assigned to only one offer per property (unique index) – reported as `service-in-use`.
 */
export async function savePropertyConfig(
  db: Database,
  context: TenantContext,
  input: {
    offerId: string;
    propertyId: string;
    config: PropertyConfigInput;
    actorAdminId: string;
    now: Date;
  },
): Promise<ConfigSaveResult> {
  assertTenantContext(context);
  if (!UUID.test(input.offerId) || !isEntityKey(input.propertyId))
    return { ok: false, reason: "not-found" };
  return db.transaction(async (tx) => {
    const [offer] = await tx
      .select({ id: offers.id })
      .from(offers)
      .where(
        and(
          eq(offers.tenantId, context.tenantId),
          eq(offers.id, input.offerId),
          eq(offers.kind, "house-service"),
        ),
      );
    const [property] = await tx
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.tenantId, context.tenantId), eq(properties.id, input.propertyId)));
    if (!offer || !property) return { ok: false, reason: "not-found" } as const;
    if (input.config.extrasServiceId) {
      const [other] = await tx
        .select({ offerId: offerProperties.offerId })
        .from(offerProperties)
        .where(
          and(
            eq(offerProperties.tenantId, context.tenantId),
            eq(offerProperties.propertyId, input.propertyId),
            eq(offerProperties.extrasServiceId, input.config.extrasServiceId),
          ),
        );
      if (other && other.offerId !== input.offerId)
        return { ok: false, reason: "service-in-use" } as const;
    }
    const [existing] = await tx
      .select()
      .from(offerProperties)
      .where(
        and(
          eq(offerProperties.tenantId, context.tenantId),
          eq(offerProperties.offerId, input.offerId),
          eq(offerProperties.propertyId, input.propertyId),
        ),
      )
      .for("update");
    const values = {
      ...input.config,
      allowedUnitGroupIds: [...input.config.allowedUnitGroupIds],
      currency: input.config.extraPersonPriceCents === null ? null : "EUR",
      updatedBy: input.actorAdminId,
      updatedAt: input.now,
    };
    if (existing) {
      const before = toConfig(existing);
      const changedFields = CONFIG_FIELDS.filter(
        (field) => JSON.stringify(before[field]) !== JSON.stringify(input.config[field]),
      );
      if (!changedFields.length) return { ok: true, created: false } as const;
      await tx
        .update(offerProperties)
        .set(values)
        .where(
          and(
            eq(offerProperties.tenantId, context.tenantId),
            eq(offerProperties.offerId, input.offerId),
            eq(offerProperties.propertyId, input.propertyId),
          ),
        );
      await recordAdminAuditEvent(tx, context, {
        actorType: "admin",
        actorAdminId: input.actorAdminId,
        propertyId: input.propertyId,
        action: "catalog.property_config_updated",
        entityType: "offer",
        entityId: input.offerId,
        details: { changedFields },
      });
      return { ok: true, created: false } as const;
    }
    await tx.insert(offerProperties).values({
      tenantId: context.tenantId,
      offerId: input.offerId,
      propertyId: input.propertyId,
      ...values,
      createdAt: input.now,
    });
    await recordAdminAuditEvent(tx, context, {
      actorType: "admin",
      actorAdminId: input.actorAdminId,
      propertyId: input.propertyId,
      action: "catalog.property_config_created",
      entityType: "offer",
      entityId: input.offerId,
    });
    return { ok: true, created: true } as const;
  });
}

/** Removes an offer from one property (the offer itself stays). */
export async function removePropertyConfig(
  db: Database,
  context: TenantContext,
  input: { offerId: string; propertyId: string; actorAdminId: string },
): Promise<boolean> {
  assertTenantContext(context);
  if (!UUID.test(input.offerId) || !isEntityKey(input.propertyId)) return false;
  return db.transaction(async (tx) => {
    const rows = await tx
      .delete(offerProperties)
      .where(
        and(
          eq(offerProperties.tenantId, context.tenantId),
          eq(offerProperties.offerId, input.offerId),
          eq(offerProperties.propertyId, input.propertyId),
        ),
      )
      .returning({ offerId: offerProperties.offerId });
    if (!rows.length) return false;
    await recordAdminAuditEvent(tx, context, {
      actorType: "admin",
      actorAdminId: input.actorAdminId,
      propertyId: input.propertyId,
      action: "catalog.property_config_removed",
      entityType: "offer",
      entityId: input.offerId,
    });
    return true;
  });
}
