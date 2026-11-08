/**
 * Upselling catalog (concept docs/concepts/upselling-plattform.md, Phase 1): partners, offers
 * and their property assignment, daily success counters and (prepared) requests.
 * Validation happens in @up/core (`offerSchema`, `partnerSchema`); every query is tenant-bound.
 */
import {
  DEFAULT_AVAILABILITY,
  isEntityKey,
  metricDelta,
  type OfferInput,
  type OfferMetricCounters,
  type OfferMetricIncrement,
  type OfferStatus,
  type PartnerInput,
  type PropertyOffer,
  type ReservationProvider,
  type TenantContext,
} from "@up/core";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { type Database } from "../client";
import {
  explorePlaces,
  offerMetricsDaily,
  offerProperties,
  offerRequests,
  offers,
  partners,
} from "../schema";

function assertTenantContext(context: TenantContext): void {
  if (!isEntityKey(context.tenantId)) throw new TypeError("Invalid tenant context");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------------------------------
 * Writing (admin – Phase 3; seeds and tests now)
 * ---------------------------------------------------------------------------------------- */

export async function upsertPartner(
  db: Database,
  context: TenantContext,
  input: PartnerInput & { id?: string },
): Promise<string> {
  assertTenantContext(context);
  const values = {
    tenantId: context.tenantId,
    name: input.name,
    status: input.status,
    explorePlaceId: input.explorePlaceId ?? null,
    websiteUrl: input.websiteUrl ?? null,
    commission: input.commission,
  };
  const [row] = input.id
    ? await db
        .insert(partners)
        .values({ id: input.id, ...values })
        .onConflictDoUpdate({ target: partners.id, set: { ...values, updatedAt: new Date() } })
        .returning({ id: partners.id, tenantId: partners.tenantId })
    : await db
        .insert(partners)
        .values(values)
        .returning({ id: partners.id, tenantId: partners.tenantId });
  if (!row || row.tenantId !== context.tenantId)
    throw new Error("partner belongs to another tenant");
  return row.id;
}

/** Creates or replaces an offer including its property assignment (validated input). */
export async function upsertOffer(
  db: Database,
  context: TenantContext,
  input: OfferInput & { id?: string; status: OfferStatus },
  now = new Date(),
): Promise<string> {
  assertTenantContext(context);
  const values = {
    tenantId: context.tenantId,
    kind: input.kind,
    partnerId: input.partnerId ?? null,
    category: input.category,
    status: input.status,
    slug: input.slug,
    title: input.title,
    teaser: input.teaser,
    body: input.body ?? null,
    details: input.details ?? null,
    heroImage: input.heroImage ?? null,
    gallery: input.gallery,
    fulfillment: input.fulfillment,
    bookingUrl: input.bookingUrl ?? null,
    price: input.price ?? null,
    durationMinutes: input.durationMinutes ?? null,
    cancellation: input.cancellation,
    commission: input.commission ?? null,
    availability: input.availability,
    featured: input.featured,
    sortOrder: input.sortOrder,
    ...(input.status === "published" ? { firstPublishedAt: now } : {}),
  };
  return db.transaction(async (tx) => {
    const [row] = input.id
      ? await tx
          .insert(offers)
          .values({ id: input.id, ...values })
          .onConflictDoUpdate({
            target: offers.id,
            set: {
              ...values,
              // Keep the first publication date once set.
              firstPublishedAt: sql`coalesce(${offers.firstPublishedAt}, ${input.status === "published" ? now.toISOString() : null}::timestamptz)`,
              updatedAt: now,
            },
          })
          .returning({ id: offers.id, tenantId: offers.tenantId })
      : await tx
          .insert(offers)
          .values(values)
          .returning({ id: offers.id, tenantId: offers.tenantId });
    if (!row || row.tenantId !== context.tenantId)
      throw new Error("offer belongs to another tenant");
    await tx
      .delete(offerProperties)
      .where(
        and(eq(offerProperties.tenantId, context.tenantId), eq(offerProperties.offerId, row.id)),
      );
    if (input.properties.length > 0) {
      await tx.insert(offerProperties).values(
        input.properties.map((assignment) => ({
          tenantId: context.tenantId,
          offerId: row.id,
          propertyId: assignment.propertyId,
          extrasServiceId: assignment.extrasServiceId ?? null,
          sortOrder: assignment.sortOrder,
        })),
      );
    }
    return row.id;
  });
}

/* ------------------------------------------------------------------------------------------
 * Reading (guest)
 * ---------------------------------------------------------------------------------------- */

type Row = {
  offer: typeof offers.$inferSelect;
  assignment: typeof offerProperties.$inferSelect;
  partner: typeof partners.$inferSelect | null;
  place: Pick<typeof explorePlaces.$inferSelect, "locality" | "address"> | null;
};

function toPropertyOffer({ offer, assignment, partner, place }: Row): PropertyOffer {
  return {
    id: offer.id,
    tenantId: offer.tenantId,
    kind: offer.kind,
    ...(offer.partnerId ? { partnerId: offer.partnerId } : {}),
    category: offer.category,
    status: offer.status,
    slug: offer.slug,
    title: offer.title,
    teaser: offer.teaser,
    ...(offer.body ? { body: offer.body } : {}),
    ...(offer.details ? { details: offer.details } : {}),
    ...(offer.heroImage ? { heroImage: offer.heroImage } : {}),
    gallery: offer.gallery,
    fulfillment: offer.fulfillment,
    ...(offer.bookingUrl ? { bookingUrl: offer.bookingUrl } : {}),
    ...(offer.price ? { price: offer.price } : {}),
    ...(offer.durationMinutes ? { durationMinutes: offer.durationMinutes } : {}),
    cancellation: offer.cancellation,
    ...(offer.commission ? { commission: offer.commission } : {}),
    availability: { ...DEFAULT_AVAILABILITY, ...offer.availability },
    featured: offer.featured,
    sortOrder: offer.sortOrder,
    translationState: offer.translationState,
    propertyId: assignment.propertyId,
    ...(assignment.extrasServiceId ? { extrasServiceId: assignment.extrasServiceId } : {}),
    propertySortOrder: assignment.sortOrder,
    ...(partner
      ? {
          partner: {
            id: partner.id,
            name: partner.name,
            commission: partner.commission,
            ...(partner.websiteUrl ? { websiteUrl: partner.websiteUrl } : {}),
            ...(place?.locality ? { locality: place.locality } : {}),
            ...(place?.address ? { address: place.address } : {}),
          },
        }
      : {}),
  };
}

/**
 * Offers of one property (published by default), in editorial order. Partner offers of an
 * inactive partner are left out.
 */
export async function listPropertyOffers(
  db: Database,
  context: TenantContext,
  propertyId: string,
  options: { statuses?: readonly OfferStatus[] } = {},
): Promise<PropertyOffer[]> {
  assertTenantContext(context);
  const statuses = options.statuses ?? ["published"];
  const rows = await db
    .select({
      offer: offers,
      assignment: offerProperties,
      partner: partners,
      place: { locality: explorePlaces.locality, address: explorePlaces.address },
    })
    .from(offerProperties)
    .innerJoin(
      offers,
      and(eq(offers.tenantId, offerProperties.tenantId), eq(offers.id, offerProperties.offerId)),
    )
    .leftJoin(
      partners,
      and(eq(partners.tenantId, offers.tenantId), eq(partners.id, offers.partnerId)),
    )
    .leftJoin(
      explorePlaces,
      and(
        eq(explorePlaces.tenantId, partners.tenantId),
        eq(explorePlaces.id, partners.explorePlaceId),
      ),
    )
    .where(
      and(
        eq(offerProperties.tenantId, context.tenantId),
        eq(offerProperties.propertyId, propertyId),
        inArray(offers.status, [...statuses]),
      ),
    )
    .orderBy(asc(offerProperties.sortOrder), asc(offers.sortOrder), asc(offers.id));
  return rows
    .filter((row) => row.offer.kind === "house-service" || row.partner?.status === "active")
    .map((row) => toPropertyOffer(row));
}

/** One published offer of the property by its slug in the given locale (or German). */
export async function findPropertyOfferBySlug(
  db: Database,
  context: TenantContext,
  propertyId: string,
  slug: string,
  locale: string,
): Promise<PropertyOffer | undefined> {
  const list = await listPropertyOffers(db, context, propertyId);
  return list.find(
    (offer) => (offer.slug[locale] ?? offer.slug.de) === slug || offer.slug.de === slug,
  );
}

/* ------------------------------------------------------------------------------------------
 * Success measurement – daily totals, no personal data
 * ---------------------------------------------------------------------------------------- */

/**
 * Adds events to the day's counters. Only offers assigned to the event's property count;
 * anything else is ignored (returns how many were recorded).
 */
export async function recordOfferMetrics(
  db: Database,
  context: TenantContext,
  increments: readonly OfferMetricIncrement[],
  day: string,
): Promise<number> {
  assertTenantContext(context);
  if (!DAY.test(day)) throw new RangeError("Invalid day");
  const valid = increments.filter(
    (item) => UUID.test(item.offerId) && isEntityKey(item.propertyId),
  );
  if (valid.length === 0) return 0;
  const assigned = await db
    .select({ offerId: offerProperties.offerId, propertyId: offerProperties.propertyId })
    .from(offerProperties)
    .where(
      and(
        eq(offerProperties.tenantId, context.tenantId),
        inArray(offerProperties.offerId, [...new Set(valid.map((item) => item.offerId))]),
      ),
    );
  const allowed = new Set(assigned.map((row) => `${row.offerId}|${row.propertyId}`));
  let recorded = 0;
  for (const item of valid) {
    if (!allowed.has(`${item.offerId}|${item.propertyId}`)) continue;
    const delta = metricDelta(item);
    await db
      .insert(offerMetricsDaily)
      .values({
        tenantId: context.tenantId,
        propertyId: item.propertyId,
        offerId: item.offerId,
        day,
        placement: item.placement,
        ...delta,
      })
      .onConflictDoUpdate({
        target: [
          offerMetricsDaily.tenantId,
          offerMetricsDaily.propertyId,
          offerMetricsDaily.offerId,
          offerMetricsDaily.day,
          offerMetricsDaily.placement,
        ],
        set: {
          impressions: sql`${offerMetricsDaily.impressions} + ${delta.impressions}`,
          views: sql`${offerMetricsDaily.views} + ${delta.views}`,
          clickOuts: sql`${offerMetricsDaily.clickOuts} + ${delta.clickOuts}`,
          requests: sql`${offerMetricsDaily.requests} + ${delta.requests}`,
          bookings: sql`${offerMetricsDaily.bookings} + ${delta.bookings}`,
          revenueCents: sql`${offerMetricsDaily.revenueCents} + ${delta.revenueCents}`,
          commissionCents: sql`${offerMetricsDaily.commissionCents} + ${delta.commissionCents}`,
          updatedAt: new Date(),
        },
      });
    recorded += 1;
  }
  return recorded;
}

export type OfferMetricsRow = OfferMetricCounters & { offerId: string; placement: string };

/** Totals per offer and placement over a date range (reports, Phase 3/4). */
export async function summarizeOfferMetrics(
  db: Database,
  context: TenantContext,
  range: { from: string; to: string; propertyId?: string },
): Promise<OfferMetricsRow[]> {
  assertTenantContext(context);
  if (!DAY.test(range.from) || !DAY.test(range.to)) throw new RangeError("Invalid range");
  const rows = await db
    .select({
      offerId: offerMetricsDaily.offerId,
      placement: offerMetricsDaily.placement,
      impressions: sql<number>`sum(${offerMetricsDaily.impressions})::int`,
      views: sql<number>`sum(${offerMetricsDaily.views})::int`,
      clickOuts: sql<number>`sum(${offerMetricsDaily.clickOuts})::int`,
      requests: sql<number>`sum(${offerMetricsDaily.requests})::int`,
      bookings: sql<number>`sum(${offerMetricsDaily.bookings})::int`,
      revenueCents: sql<string>`sum(${offerMetricsDaily.revenueCents})::bigint`,
      commissionCents: sql<string>`sum(${offerMetricsDaily.commissionCents})::bigint`,
    })
    .from(offerMetricsDaily)
    .where(
      and(
        eq(offerMetricsDaily.tenantId, context.tenantId),
        gte(offerMetricsDaily.day, range.from),
        lte(offerMetricsDaily.day, range.to),
        ...(range.propertyId ? [eq(offerMetricsDaily.propertyId, range.propertyId)] : []),
      ),
    )
    .groupBy(offerMetricsDaily.offerId, offerMetricsDaily.placement);
  return rows.map((row) => ({
    ...row,
    revenueCents: Number(row.revenueCents),
    commissionCents: Number(row.commissionCents),
  }));
}

/* ------------------------------------------------------------------------------------------
 * Requests – prepared for Phase 2 ("Gebucht & angefragt")
 * ---------------------------------------------------------------------------------------- */

export type OfferRequestRecord = {
  id: string;
  offerId: string;
  status: (typeof offerRequests.$inferSelect)["status"];
  requestedDate?: string;
  people?: number;
  quotedCents?: number;
  currency?: string;
  createdAt: Date;
};

/** Requests of one reservation (for the guest's overview) – newest first. */
export async function listOfferRequestsForReservation(
  db: Database,
  context: TenantContext,
  key: { reservationProvider: ReservationProvider; externalReservationId: string },
): Promise<OfferRequestRecord[]> {
  assertTenantContext(context);
  const rows = await db
    .select()
    .from(offerRequests)
    .where(
      and(
        eq(offerRequests.tenantId, context.tenantId),
        eq(offerRequests.reservationProvider, key.reservationProvider),
        eq(offerRequests.externalReservationId, key.externalReservationId),
      ),
    )
    .orderBy(sql`${offerRequests.createdAt} desc`);
  return rows.map((row) => ({
    id: row.id,
    offerId: row.offerId,
    status: row.status,
    createdAt: row.createdAt,
    ...(row.requestedDate ? { requestedDate: row.requestedDate } : {}),
    ...(row.people ? { people: row.people } : {}),
    ...(row.quotedCents !== null ? { quotedCents: row.quotedCents } : {}),
    ...(row.currency ? { currency: row.currency } : {}),
  }));
}
