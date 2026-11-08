/**
 * Persistence of the STAY service booking engine (M3): configuration for the engine, guest
 * orders (service_bookings/items), requests, stay extensions, notification outbox and the
 * short-lived claims (service_locks). Structurally implements `ServiceRecordStore` and
 * `ServiceLockStore` of @up/integrations. No guest names or e-mail addresses are stored.
 */
import { isEntityKey, type StayExtensionSettings, type TenantContext } from "@up/core";
import { and, asc, eq, lt, sql } from "drizzle-orm";

import { type Database } from "../client";
import {
  offerProperties,
  offerRequests,
  offers,
  serviceBookingItems,
  serviceBookings,
  serviceLocks,
  stayExtensions,
} from "../schema";
import { decideOfferRequest } from "./operations-repository";
import { enqueueNotification, getPropertyServiceSettings } from "./service-operations-repository";

function assertTenantContext(context: TenantContext): void {
  if (!isEntityKey(context.tenantId)) throw new TypeError("Invalid tenant context");
}

const REQUEST_RETENTION_DAYS = 180;
const RECORD_RETENTION_DAYS = 3650;
const DAY_MS = 86_400_000;

/* ── Claims ───────────────────────────────────────────────────────────────────────────── */

/** Takes a claim if it is free or expired (one winner among parallel callers). */
export async function claimServiceLock(
  db: Database,
  context: TenantContext,
  input: { key: string; holder: string; ttlMs: number; now: Date },
): Promise<boolean> {
  assertTenantContext(context);
  const expiresAt = new Date(input.now.getTime() + input.ttlMs);
  const rows = await db
    .insert(serviceLocks)
    .values({
      tenantId: context.tenantId,
      lockKey: input.key,
      holder: input.holder,
      expiresAt,
      createdAt: input.now,
    })
    .onConflictDoUpdate({
      target: [serviceLocks.tenantId, serviceLocks.lockKey],
      set: { holder: input.holder, expiresAt, createdAt: input.now },
      setWhere: lt(serviceLocks.expiresAt, input.now),
    })
    .returning({ holder: serviceLocks.holder });
  return rows[0]?.holder === input.holder;
}

export async function releaseServiceLock(
  db: Database,
  context: TenantContext,
  input: { key: string; holder: string },
): Promise<void> {
  assertTenantContext(context);
  await db
    .delete(serviceLocks)
    .where(
      and(
        eq(serviceLocks.tenantId, context.tenantId),
        eq(serviceLocks.lockKey, input.key),
        eq(serviceLocks.holder, input.holder),
      ),
    );
}

export function createServiceLockStore(db: Database) {
  return {
    claim: (input: { tenantId: string; key: string; holder: string; ttlMs: number; now: Date }) =>
      claimServiceLock(db, { tenantId: input.tenantId }, input),
    release: (input: { tenantId: string; key: string; holder: string }) =>
      releaseServiceLock(db, { tenantId: input.tenantId }, input),
  };
}

/* ── Catalog for the engine ───────────────────────────────────────────────────────────── */

type Text = { de?: string; en?: string } | null | undefined;
const bilingual = (value: Text, fallback: Text) => ({
  de: value?.de ?? fallback?.de ?? "",
  en: value?.en ?? fallback?.en ?? "",
});

/** Own services configured for a property (offer texts + property configuration). */
export async function loadEngineCatalog(db: Database, context: TenantContext, propertyId: string) {
  assertTenantContext(context);
  const rows = await db
    .select({ offer: offers, config: offerProperties })
    .from(offerProperties)
    .innerJoin(
      offers,
      and(eq(offers.tenantId, offerProperties.tenantId), eq(offers.id, offerProperties.offerId)),
    )
    .where(
      and(
        eq(offerProperties.tenantId, context.tenantId),
        eq(offerProperties.propertyId, propertyId),
        eq(offers.kind, "house-service"),
        sql`${offerProperties.extrasServiceId} IS NOT NULL`,
      ),
    )
    .orderBy(asc(offerProperties.sortOrder));
  return rows.map(({ offer, config }) => {
    const fulfillment = config.fulfillment ?? offer.fulfillment;
    return {
      offerId: offer.id,
      serviceId: config.extrasServiceId ?? "",
      title: bilingual(config.titleOverride, offer.title),
      description: bilingual(config.teaserOverride, offer.teaser),
      category: offer.category,
      imageUrl: (config.heroImageOverride ?? offer.heroImage)?.src ?? null,
      actionType: config.actionType ?? "service",
      bookingRule: config.bookingRule ?? "per_stay",
      fulfillment: fulfillment === "request" ? "request" : "instant",
      extraPersonPricePerNight:
        config.extraPersonPriceCents === null ? null : config.extraPersonPriceCents / 100,
      currency: config.currency,
      priceUnitLabel: config.priceUnitLabel ?? null,
      requiresRemainingCapacity: config.requiresRemainingCapacity,
      requiresVehicleRegistration: config.requiresVehicleRegistration,
      maxOnePerReservation: config.maxOnePerReservation,
      allowedUnitGroupIds: config.allowedUnitGroupIds,
      sortOrder: config.sortOrder,
      active: config.active,
      published: offer.status === "published",
    } as const;
  });
}

/* ── Guest orders ─────────────────────────────────────────────────────────────────────── */

export async function beginServiceBooking(
  db: Database,
  context: TenantContext,
  input: {
    propertyId: string;
    externalReservationId: string;
    idempotencyKey: string;
    now: Date;
    leaseMs: number;
  },
) {
  assertTenantContext(context);
  const [created] = await db
    .insert(serviceBookings)
    .values({
      tenantId: context.tenantId,
      propertyId: input.propertyId,
      reservationProvider: "apaleo",
      externalReservationId: input.externalReservationId,
      idempotencyKey: input.idempotencyKey,
      status: "processing",
      source: "stay",
      purgeAfter: new Date(input.now.getTime() + RECORD_RETENTION_DAYS * DAY_MS),
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing({ target: [serviceBookings.tenantId, serviceBookings.idempotencyKey] })
    .returning({ id: serviceBookings.id });
  if (created) return { kind: "new", id: created.id } as const;

  const [existing] = await db
    .select()
    .from(serviceBookings)
    .where(
      and(
        eq(serviceBookings.tenantId, context.tenantId),
        eq(serviceBookings.idempotencyKey, input.idempotencyKey),
      ),
    );
  if (!existing) throw new Error("Service booking vanished");
  // The same key for another reservation or property is never resumed.
  if (
    existing.externalReservationId !== input.externalReservationId ||
    existing.propertyId !== input.propertyId
  ) {
    return { kind: "done" as const, id: existing.id, status: "failed" as const, items: [] };
  }
  if (existing.status === "processing") {
    const [taken] = await db
      .update(serviceBookings)
      .set({ updatedAt: input.now })
      .where(
        and(
          eq(serviceBookings.id, existing.id),
          eq(serviceBookings.status, "processing"),
          lt(serviceBookings.updatedAt, new Date(input.now.getTime() - input.leaseMs)),
        ),
      )
      .returning({ id: serviceBookings.id });
    return taken
      ? ({ kind: "resume", id: existing.id } as const)
      : ({ kind: "in-progress", id: existing.id } as const);
  }
  const items = await db
    .select()
    .from(serviceBookingItems)
    .where(
      and(
        eq(serviceBookingItems.tenantId, context.tenantId),
        eq(serviceBookingItems.bookingId, existing.id),
      ),
    );
  return {
    kind: "done",
    id: existing.id,
    status: existing.status,
    items: items.map((i) => ({
      serviceId: i.apaleoServiceId,
      displayName: i.displayName,
      quantity: i.quantity,
      status: i.status,
      errorCode: i.errorCode,
      amountCents: i.amountCents,
    })),
  } as const;
}

/** One item per service and order (a resumed order updates its items). */
export async function saveServiceBookingItem(
  db: Database,
  context: TenantContext,
  input: {
    bookingId: string;
    offerId: string | null;
    serviceId: string;
    displayName: string;
    actionType: "service" | "increase_occupancy";
    quantity: number;
    serviceDates: readonly string[];
    amountCents: number | null;
    currency: string | null;
    status: "pending" | "booked" | "failed" | "skipped";
    errorCode: string | null;
  },
) {
  assertTenantContext(context);
  const values = {
    offerId: input.offerId,
    displayName: input.displayName.trim().slice(0, 200) || input.serviceId,
    actionType: input.actionType,
    quantity: input.quantity,
    serviceDates: [...input.serviceDates],
    amountCents: input.amountCents,
    currency: input.currency,
    status: input.status,
    errorCode: input.errorCode,
  };
  const updated = await db
    .update(serviceBookingItems)
    .set(values)
    .where(
      and(
        eq(serviceBookingItems.tenantId, context.tenantId),
        eq(serviceBookingItems.bookingId, input.bookingId),
        eq(serviceBookingItems.apaleoServiceId, input.serviceId),
      ),
    )
    .returning({ id: serviceBookingItems.id });
  if (updated.length) return;
  await db.insert(serviceBookingItems).values({
    tenantId: context.tenantId,
    bookingId: input.bookingId,
    apaleoServiceId: input.serviceId,
    ...values,
  });
}

export async function finishServiceBooking(
  db: Database,
  context: TenantContext,
  input: {
    bookingId: string;
    status: "completed" | "partial" | "failed";
    totalCents: number | null;
    currency: string | null;
    now: Date;
  },
) {
  assertTenantContext(context);
  await db
    .update(serviceBookings)
    .set({
      status: input.status,
      totalCents: input.totalCents,
      currency: input.currency,
      updatedAt: input.now,
    })
    .where(
      and(eq(serviceBookings.tenantId, context.tenantId), eq(serviceBookings.id, input.bookingId)),
    );
}

/* ── Requests ─────────────────────────────────────────────────────────────────────────── */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getEngineRequest(db: Database, context: TenantContext, requestId: string) {
  assertTenantContext(context);
  if (!UUID.test(requestId)) return null;
  const [row] = await db
    .select({ request: offerRequests, title: offers.title })
    .from(offerRequests)
    .innerJoin(
      offers,
      and(eq(offers.tenantId, offerRequests.tenantId), eq(offers.id, offerRequests.offerId)),
    )
    .where(and(eq(offerRequests.tenantId, context.tenantId), eq(offerRequests.id, requestId)));
  if (!row) return null;
  const r = row.request;
  return {
    id: r.id,
    propertyId: r.propertyId,
    externalReservationId: r.externalReservationId,
    offerId: r.offerId,
    apaleoServiceId: r.apaleoServiceId,
    quantity: r.quantity,
    requestedDates: r.requestedDates,
    status: r.status,
    source: r.source,
    serviceName: row.title.de ?? "",
  };
}

/* ── Store adapter ────────────────────────────────────────────────────────────────────── */

export function createServiceRecordStore(db: Database) {
  return {
    loadCatalog: (c: { tenantId: string; propertyId: string }) =>
      loadEngineCatalog(db, { tenantId: c.tenantId }, c.propertyId),
    getExtensionSettings: async (c: {
      tenantId: string;
      propertyId: string;
    }): Promise<StayExtensionSettings> => {
      const { slackRoute: _route, ...settings } = await getPropertyServiceSettings(
        db,
        { tenantId: c.tenantId },
        c.propertyId,
      );
      return settings;
    },
    beginBooking: (input: Parameters<typeof beginServiceBooking>[2] & { tenantId: string }) =>
      beginServiceBooking(db, { tenantId: input.tenantId }, input),
    saveBookingItem: (input: Parameters<typeof saveServiceBookingItem>[2] & { tenantId: string }) =>
      saveServiceBookingItem(db, { tenantId: input.tenantId }, input),
    finishBooking: (input: Parameters<typeof finishServiceBooking>[2] & { tenantId: string }) =>
      finishServiceBooking(db, { tenantId: input.tenantId }, input),
    createRequest: async (input: {
      tenantId: string;
      propertyId: string;
      externalReservationId: string;
      offerId: string;
      apaleoServiceId: string;
      quantity: number;
      requestedDates: readonly string[];
      quotedCents: number | null;
      currency: string | null;
      now: Date;
    }) => {
      const [row] = await db
        .insert(offerRequests)
        .values({
          tenantId: input.tenantId,
          offerId: input.offerId,
          propertyId: input.propertyId,
          reservationProvider: "apaleo",
          externalReservationId: input.externalReservationId,
          status: "pending",
          requestedDate: input.requestedDates[0] ?? null,
          apaleoServiceId: input.apaleoServiceId,
          quantity: Math.min(Math.max(Math.trunc(input.quantity), 1), 50),
          requestedDates: [...input.requestedDates],
          quotedCents: input.quotedCents,
          currency: input.currency,
          source: "stay",
          purgeAfter: new Date(input.now.getTime() + REQUEST_RETENTION_DAYS * DAY_MS),
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning({ id: offerRequests.id });
      if (!row) throw new Error("Request was not stored");
      return { id: row.id };
    },
    getRequest: (c: { tenantId: string }, requestId: string) =>
      getEngineRequest(db, { tenantId: c.tenantId }, requestId),
    completeRequest: async (input: {
      tenantId: string;
      requestId: string;
      decision: "confirm" | "decline";
      bookedServiceDates?: readonly string[];
      actorAdminId: string | null;
      now: Date;
    }) => {
      if (!input.actorAdminId) return { ok: false as const, reason: "not-found" as const };
      return decideOfferRequest(
        db,
        { tenantId: input.tenantId },
        {
          requestId: input.requestId,
          decision: input.decision === "confirm" ? "confirmed" : "declined",
          actorAdminId: input.actorAdminId,
          now: input.now,
          bookedServiceDates: input.bookedServiceDates,
        },
      );
    },
    addStayExtension: async (input: {
      tenantId: string;
      propertyId: string;
      externalReservationId: string;
      oldDeparture: string;
      newDeparture: string;
      newDepartureConfirmed: boolean;
      phase: "pre_arrival" | "in_house";
      gap: number;
      averageNightlyRateCents: number | null;
      discountPercent: number;
      extensionPriceCents: number | null;
      totalAdditionalCents: number | null;
      currency: string;
      details: Record<string, unknown>;
      mandatoryServicesIntact: boolean;
      status: "confirmed" | "confirmed_with_issues" | "failed";
      now: Date;
    }) => {
      const { tenantId, now, ...values } = input;
      const [row] = await db
        .insert(stayExtensions)
        .values({
          tenantId,
          reservationProvider: "apaleo",
          source: "stay",
          ...values,
          purgeAfter: new Date(now.getTime() + RECORD_RETENTION_DAYS * DAY_MS),
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: stayExtensions.id });
      if (!row) throw new Error("Stay extension was not stored");
      return { id: row.id };
    },
    notify: async (input: {
      tenantId: string;
      propertyId: string;
      template: string;
      dedupKey: string;
      payload: Record<string, unknown>;
    }) => {
      await enqueueNotification(
        db,
        { tenantId: input.tenantId },
        {
          channel: "slack",
          template: input.template,
          dedupKey: input.dedupKey,
          propertyId: input.propertyId,
          payload: input.payload,
        },
      );
    },
  };
}
