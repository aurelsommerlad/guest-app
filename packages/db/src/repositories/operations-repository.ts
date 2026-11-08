/**
 * Operational administration (M2): order history, request queue, stay extensions and import
 * runs – read models plus the request decision. Lists are tenant-bound and, for
 * property-limited admins, filtered by property. No guest names or e-mail addresses exist in
 * these tables.
 */
import { isEntityKey, type LocalizedText, type TenantContext } from "@up/core";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { type AnyPgColumn } from "drizzle-orm/pg-core";

import { type Database } from "../client";
import {
  migrationItems,
  migrationRuns,
  offerRequests,
  offers,
  serviceBookingItems,
  serviceBookings,
  stayExtensions,
} from "../schema";
import { recordAdminAuditEvent } from "./audit-repository";

function assertTenantContext(context: TenantContext): void {
  if (!isEntityKey(context.tenantId)) throw new TypeError("Invalid tenant context");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Scope = { propertyIds?: readonly string[]; limit?: number };
const limitOf = (scope: Scope) => Math.min(Math.max(scope.limit ?? 200, 1), 500);
const propertyFilter = (column: AnyPgColumn, scope: Scope) =>
  // "-" never matches a property id: keeps IN () valid for an empty selection.
  scope.propertyIds ? inArray(column, [...scope.propertyIds, "-"]) : undefined;

/* ── Orders ───────────────────────────────────────────────────────────────────────────── */

export type ServiceBookingRow = typeof serviceBookings.$inferSelect & { itemCount: number };
export type ServiceBookingDetail = typeof serviceBookings.$inferSelect & {
  items: (typeof serviceBookingItems.$inferSelect)[];
};

export async function listServiceBookings(
  db: Database,
  context: TenantContext,
  scope: Scope = {},
): Promise<ServiceBookingRow[]> {
  assertTenantContext(context);
  const rows = await db
    .select()
    .from(serviceBookings)
    .where(
      and(
        eq(serviceBookings.tenantId, context.tenantId),
        propertyFilter(serviceBookings.propertyId, scope),
      ),
    )
    .orderBy(desc(serviceBookings.createdAt))
    .limit(limitOf(scope));
  if (!rows.length) return [];
  const items = await db
    .select({ bookingId: serviceBookingItems.bookingId })
    .from(serviceBookingItems)
    .where(
      and(
        eq(serviceBookingItems.tenantId, context.tenantId),
        inArray(
          serviceBookingItems.bookingId,
          rows.map((r) => r.id),
        ),
      ),
    );
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.bookingId, (counts.get(item.bookingId) ?? 0) + 1);
  return rows.map((row) => ({ ...row, itemCount: counts.get(row.id) ?? 0 }));
}

export async function getServiceBooking(
  db: Database,
  context: TenantContext,
  bookingId: string,
): Promise<ServiceBookingDetail | undefined> {
  assertTenantContext(context);
  if (!UUID.test(bookingId)) return undefined;
  const [row] = await db
    .select()
    .from(serviceBookings)
    .where(and(eq(serviceBookings.tenantId, context.tenantId), eq(serviceBookings.id, bookingId)));
  if (!row) return undefined;
  const items = await db
    .select()
    .from(serviceBookingItems)
    .where(
      and(
        eq(serviceBookingItems.tenantId, context.tenantId),
        eq(serviceBookingItems.bookingId, bookingId),
      ),
    )
    .orderBy(asc(serviceBookingItems.createdAt));
  return { ...row, items };
}

/* ── Requests ─────────────────────────────────────────────────────────────────────────── */

export type OfferRequestRow = typeof offerRequests.$inferSelect & { offerTitle: LocalizedText };

export async function listOfferRequestsForAdmin(
  db: Database,
  context: TenantContext,
  scope: Scope & { status?: (typeof offerRequests.$inferSelect)["status"] } = {},
): Promise<OfferRequestRow[]> {
  assertTenantContext(context);
  const rows = await db
    .select({ request: offerRequests, offerTitle: offers.title })
    .from(offerRequests)
    .innerJoin(
      offers,
      and(eq(offers.tenantId, offerRequests.tenantId), eq(offers.id, offerRequests.offerId)),
    )
    .where(
      and(
        eq(offerRequests.tenantId, context.tenantId),
        propertyFilter(offerRequests.propertyId, scope),
        scope.status ? eq(offerRequests.status, scope.status) : undefined,
      ),
    )
    .orderBy(desc(offerRequests.createdAt))
    .limit(limitOf(scope));
  return rows.map((row) => ({ ...row.request, offerTitle: row.offerTitle }));
}

export async function getOfferRequestForAdmin(
  db: Database,
  context: TenantContext,
  requestId: string,
): Promise<OfferRequestRow | undefined> {
  assertTenantContext(context);
  if (!UUID.test(requestId)) return undefined;
  const [row] = await db
    .select({ request: offerRequests, offerTitle: offers.title })
    .from(offerRequests)
    .innerJoin(
      offers,
      and(eq(offers.tenantId, offerRequests.tenantId), eq(offers.id, offerRequests.offerId)),
    )
    .where(and(eq(offerRequests.tenantId, context.tenantId), eq(offerRequests.id, requestId)));
  return row ? { ...row.request, offerTitle: row.offerTitle } : undefined;
}

export type RequestDecisionResult =
  { ok: true } | { ok: false; reason: "not-found" | "not-pending" | "handled-in-extras" };

/**
 * Records a decision on a pending STAY request. Requests imported from Extras are handled in
 * Extras until the joint go-live and cannot be decided here. Optimistic: only a request that
 * is still `pending` changes, so two admins deciding at once cannot both win.
 */
export async function decideOfferRequest(
  db: Database,
  context: TenantContext,
  input: {
    requestId: string;
    decision: "confirmed" | "declined";
    actorAdminId: string;
    now: Date;
    bookedServiceDates?: readonly string[];
    writeResult?: string;
  },
): Promise<RequestDecisionResult> {
  assertTenantContext(context);
  if (!UUID.test(input.requestId)) return { ok: false, reason: "not-found" };
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(offerRequests)
      .where(
        and(eq(offerRequests.tenantId, context.tenantId), eq(offerRequests.id, input.requestId)),
      )
      .for("update");
    if (!current) return { ok: false, reason: "not-found" } as const;
    if (current.source === "extras") return { ok: false, reason: "handled-in-extras" } as const;
    if (current.status !== "pending") return { ok: false, reason: "not-pending" } as const;
    await tx
      .update(offerRequests)
      .set({
        status: input.decision,
        handledBy: input.actorAdminId,
        handledAt: input.now,
        ...(input.bookedServiceDates ? { bookedServiceDates: [...input.bookedServiceDates] } : {}),
        updatedAt: input.now,
      })
      .where(
        and(eq(offerRequests.tenantId, context.tenantId), eq(offerRequests.id, input.requestId)),
      );
    await recordAdminAuditEvent(tx, context, {
      actorType: "admin",
      actorAdminId: input.actorAdminId,
      propertyId: current.propertyId,
      action: input.decision === "confirmed" ? "request.confirmed" : "request.declined",
      entityType: "offer_request",
      entityId: input.requestId,
      details: input.writeResult ? { writeResult: input.writeResult } : {},
    });
    return { ok: true } as const;
  });
}

/** Open requests that can be decided in STAY (imported Extras requests are decided in Extras). */
export async function countPendingOfferRequests(
  db: Database,
  context: TenantContext,
  scope: Scope = {},
): Promise<number> {
  assertTenantContext(context);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(offerRequests)
    .where(
      and(
        eq(offerRequests.tenantId, context.tenantId),
        eq(offerRequests.status, "pending"),
        eq(offerRequests.source, "stay"),
        propertyFilter(offerRequests.propertyId, scope),
      ),
    );
  return row?.count ?? 0;
}

/* ── Stay extensions ──────────────────────────────────────────────────────────────────── */

export type StayExtensionRow = typeof stayExtensions.$inferSelect;

export async function listStayExtensions(
  db: Database,
  context: TenantContext,
  scope: Scope = {},
): Promise<StayExtensionRow[]> {
  assertTenantContext(context);
  return db
    .select()
    .from(stayExtensions)
    .where(
      and(
        eq(stayExtensions.tenantId, context.tenantId),
        propertyFilter(stayExtensions.propertyId, scope),
      ),
    )
    .orderBy(desc(stayExtensions.createdAt))
    .limit(limitOf(scope));
}

export async function getStayExtension(
  db: Database,
  context: TenantContext,
  extensionId: string,
): Promise<StayExtensionRow | undefined> {
  assertTenantContext(context);
  if (!UUID.test(extensionId)) return undefined;
  const [row] = await db
    .select()
    .from(stayExtensions)
    .where(and(eq(stayExtensions.tenantId, context.tenantId), eq(stayExtensions.id, extensionId)));
  return row;
}

/* ── Import runs ──────────────────────────────────────────────────────────────────────── */

export type MigrationRunRow = typeof migrationRuns.$inferSelect;
export type MigrationItemRow = typeof migrationItems.$inferSelect;

export async function listMigrationRuns(
  db: Database,
  context: TenantContext,
  limit = 50,
): Promise<MigrationRunRow[]> {
  assertTenantContext(context);
  return db
    .select()
    .from(migrationRuns)
    .where(eq(migrationRuns.tenantId, context.tenantId))
    .orderBy(desc(migrationRuns.startedAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}

export async function getMigrationRun(
  db: Database,
  context: TenantContext,
  runId: string,
): Promise<{ run: MigrationRunRow; items: MigrationItemRow[] } | undefined> {
  assertTenantContext(context);
  if (!UUID.test(runId)) return undefined;
  const [run] = await db
    .select()
    .from(migrationRuns)
    .where(and(eq(migrationRuns.tenantId, context.tenantId), eq(migrationRuns.id, runId)));
  if (!run) return undefined;
  const items = await db
    .select()
    .from(migrationItems)
    .where(and(eq(migrationItems.tenantId, context.tenantId), eq(migrationItems.runId, runId)))
    .orderBy(asc(migrationItems.entityType), asc(migrationItems.sourceKey));
  return { run, items };
}
