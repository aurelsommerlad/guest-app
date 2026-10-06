/**
 * EXPLORE places (ADR 0015). Every function requires a TenantContext and filters by
 * `tenant_id` in SQL. Property assignments are validated against the tenant before
 * writing; the composite foreign keys make a cross-tenant assignment impossible anyway.
 */
import { type ExplorePlace, type ExploreStatus, isEntityKey, type TenantContext } from "@up/core";
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";

import { type Database } from "../client";
import { explorePlaceProperties, explorePlaces, properties } from "../schema";

type Row = typeof explorePlaces.$inferSelect;

export type ExplorePlaceRecord = ExplorePlace & {
  firstPublishedAt?: Date;
  updatedAt: Date;
};

/** Everything the admin edits (status and identity are handled separately). */
export type ExplorePlaceFields = Pick<
  ExplorePlace,
  | "category"
  | "slug"
  | "title"
  | "teaser"
  | "description"
  | "tip"
  | "openingHours"
  | "heroImage"
  | "address"
  | "locality"
  | "mapsUrl"
  | "websiteUrl"
  | "phone"
  | "reservationUrl"
  | "featured"
  | "translationState"
  | "propertyIds"
>;

/** A property id that is not one of the tenant's properties. */
export class ExploreAssignmentError extends Error {
  override name = "ExploreAssignmentError";
  constructor() {
    super("Explore place assigned to an unknown property");
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function assertTenantContext(context: TenantContext): void {
  if (!isEntityKey(context.tenantId)) throw new TypeError("Invalid tenant context");
}

function optional<K extends string, V>(key: K, value: V | null): Partial<Record<K, V>> {
  return value === null ? {} : ({ [key]: value } as Record<K, V>);
}

function toRecord(row: Row, propertyIds: readonly string[]): ExplorePlaceRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    status: row.status,
    category: row.category,
    slug: row.slug,
    title: row.title,
    teaser: row.teaser,
    ...optional("description", row.description),
    ...optional("tip", row.tip),
    ...optional("openingHours", row.openingHours),
    ...optional("heroImage", row.heroImage),
    ...optional("address", row.address),
    ...optional("locality", row.locality),
    ...optional("mapsUrl", row.mapsUrl),
    ...optional("websiteUrl", row.websiteUrl),
    ...optional("phone", row.phone),
    ...optional("reservationUrl", row.reservationUrl),
    sortOrder: row.sortOrder,
    featured: row.featured,
    propertyIds,
    translationState: row.translationState,
    ...optional("firstPublishedAt", row.firstPublishedAt),
    updatedAt: row.updatedAt,
  };
}

async function withAssignments(
  db: Database,
  context: TenantContext,
  rows: readonly Row[],
): Promise<ExplorePlaceRecord[]> {
  if (rows.length === 0) return [];
  const assignments = await db
    .select({
      placeId: explorePlaceProperties.placeId,
      propertyId: explorePlaceProperties.propertyId,
    })
    .from(explorePlaceProperties)
    .where(
      and(
        eq(explorePlaceProperties.tenantId, context.tenantId),
        inArray(
          explorePlaceProperties.placeId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(asc(explorePlaceProperties.propertyId));
  return rows.map((row) =>
    toRecord(
      row,
      assignments.filter((item) => item.placeId === row.id).map((item) => item.propertyId),
    ),
  );
}

const editorialOrder = [
  desc(explorePlaces.featured),
  asc(explorePlaces.sortOrder),
  asc(explorePlaces.createdAt),
];

/** Published places assigned to one property – what a guest of that property sees. */
export async function listPublishedExplorePlaces(
  db: Database,
  context: TenantContext,
  propertyId: string,
): Promise<ExplorePlaceRecord[]> {
  assertTenantContext(context);
  if (!isEntityKey(propertyId)) return [];
  const rows = await db
    .select({ place: explorePlaces })
    .from(explorePlaces)
    .innerJoin(
      explorePlaceProperties,
      and(
        eq(explorePlaceProperties.tenantId, explorePlaces.tenantId),
        eq(explorePlaceProperties.placeId, explorePlaces.id),
      ),
    )
    .where(
      and(
        eq(explorePlaces.tenantId, context.tenantId),
        eq(explorePlaces.status, "published"),
        eq(explorePlaceProperties.propertyId, propertyId),
      ),
    )
    .orderBy(...editorialOrder);
  return withAssignments(
    db,
    context,
    rows.map((row) => row.place),
  );
}

/**
 * Places for the admin: all of the tenant, or only those assigned to one property.
 * Archived places only on request.
 */
export async function listExplorePlaces(
  db: Database,
  context: TenantContext,
  options: { propertyId?: string; includeArchived?: boolean } = {},
): Promise<ExplorePlaceRecord[]> {
  assertTenantContext(context);
  const conditions = and(
    eq(explorePlaces.tenantId, context.tenantId),
    options.includeArchived ? undefined : ne(explorePlaces.status, "archived"),
  );
  if (options.propertyId === undefined) {
    const rows = await db
      .select()
      .from(explorePlaces)
      .where(conditions)
      .orderBy(...editorialOrder);
    return withAssignments(db, context, rows);
  }
  if (!isEntityKey(options.propertyId)) return [];
  const rows = await db
    .select({ place: explorePlaces })
    .from(explorePlaces)
    .innerJoin(
      explorePlaceProperties,
      and(
        eq(explorePlaceProperties.tenantId, explorePlaces.tenantId),
        eq(explorePlaceProperties.placeId, explorePlaces.id),
      ),
    )
    .where(and(conditions, eq(explorePlaceProperties.propertyId, options.propertyId)))
    .orderBy(...editorialOrder);
  return withAssignments(
    db,
    context,
    rows.map((row) => row.place),
  );
}

export async function getExplorePlace(
  db: Database,
  context: TenantContext,
  id: string,
): Promise<ExplorePlaceRecord | undefined> {
  assertTenantContext(context);
  if (!UUID.test(id)) return undefined;
  const rows = await db
    .select()
    .from(explorePlaces)
    .where(and(eq(explorePlaces.tenantId, context.tenantId), eq(explorePlaces.id, id)));
  const [record] = await withAssignments(db, context, rows);
  return record;
}

function fieldColumns(fields: ExplorePlaceFields) {
  return {
    category: fields.category,
    slug: fields.slug,
    title: fields.title,
    teaser: fields.teaser,
    description: fields.description ?? null,
    tip: fields.tip ?? null,
    openingHours: fields.openingHours ?? null,
    heroImage: fields.heroImage ?? null,
    address: fields.address ?? null,
    locality: fields.locality ?? null,
    mapsUrl: fields.mapsUrl ?? null,
    websiteUrl: fields.websiteUrl ?? null,
    phone: fields.phone ?? null,
    reservationUrl: fields.reservationUrl ?? null,
    featured: fields.featured,
    translationState: fields.translationState,
  };
}

/** All ids must be properties of the tenant – checked before writing. */
async function assertOwnProperties(
  db: Pick<Database, "select">,
  context: TenantContext,
  propertyIds: readonly string[],
): Promise<string[]> {
  const ids = [...new Set(propertyIds)];
  if (ids.length === 0) return [];
  if (!ids.every(isEntityKey)) throw new ExploreAssignmentError();
  const own = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.tenantId, context.tenantId), inArray(properties.id, ids)));
  if (own.length !== ids.length) throw new ExploreAssignmentError();
  return ids;
}

export async function createExplorePlace(
  db: Database,
  context: TenantContext,
  fields: ExplorePlaceFields & { sortOrder: number },
): Promise<ExplorePlaceRecord> {
  assertTenantContext(context);
  return db.transaction(async (tx) => {
    const propertyIds = await assertOwnProperties(tx, context, fields.propertyIds);
    const [row] = await tx
      .insert(explorePlaces)
      .values({
        tenantId: context.tenantId,
        status: "draft",
        sortOrder: fields.sortOrder,
        ...fieldColumns(fields),
      })
      .returning();
    if (!row) throw new Error("Insert returned no row");
    if (propertyIds.length > 0) {
      await tx.insert(explorePlaceProperties).values(
        propertyIds.map((propertyId) => ({
          tenantId: context.tenantId,
          placeId: row.id,
          propertyId,
        })),
      );
    }
    return toRecord(row, [...propertyIds].sort());
  });
}

/** Saves all fields and replaces the property assignments. Published → live at once. */
export async function updateExplorePlace(
  db: Database,
  context: TenantContext,
  id: string,
  fields: ExplorePlaceFields,
): Promise<boolean> {
  assertTenantContext(context);
  if (!UUID.test(id)) return false;
  return db.transaction(async (tx) => {
    const propertyIds = await assertOwnProperties(tx, context, fields.propertyIds);
    const updated = await tx
      .update(explorePlaces)
      .set({ ...fieldColumns(fields), updatedAt: new Date() })
      .where(and(eq(explorePlaces.tenantId, context.tenantId), eq(explorePlaces.id, id)))
      .returning({ id: explorePlaces.id });
    if (updated.length === 0) return false;
    await tx
      .delete(explorePlaceProperties)
      .where(
        and(
          eq(explorePlaceProperties.tenantId, context.tenantId),
          eq(explorePlaceProperties.placeId, id),
        ),
      );
    if (propertyIds.length > 0) {
      await tx.insert(explorePlaceProperties).values(
        propertyIds.map((propertyId) => ({
          tenantId: context.tenantId,
          placeId: id,
          propertyId,
        })),
      );
    }
    return true;
  });
}

export async function setExplorePlaceStatus(
  db: Database,
  context: TenantContext,
  id: string,
  status: ExploreStatus,
  now: Date,
): Promise<boolean> {
  assertTenantContext(context);
  if (!UUID.test(id)) return false;
  const where = and(eq(explorePlaces.tenantId, context.tenantId), eq(explorePlaces.id, id));
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(explorePlaces)
      .set({ status, updatedAt: now })
      .where(where)
      .returning({ id: explorePlaces.id });
    if (status === "published") {
      await tx
        .update(explorePlaces)
        .set({ firstPublishedAt: now })
        .where(and(where, isNull(explorePlaces.firstPublishedAt)));
    }
    return updated.length > 0;
  });
}

/** Only never-published places can be deleted (others are archived). */
export async function deleteUnpublishedExplorePlace(
  db: Database,
  context: TenantContext,
  id: string,
): Promise<boolean> {
  assertTenantContext(context);
  if (!UUID.test(id)) return false;
  const deleted = await db
    .delete(explorePlaces)
    .where(
      and(
        eq(explorePlaces.tenantId, context.tenantId),
        eq(explorePlaces.id, id),
        isNull(explorePlaces.firstPublishedAt),
      ),
    )
    .returning({ id: explorePlaces.id });
  return deleted.length > 0;
}

/** Sets sort_order 10, 20, … in the given order (ids of other tenants are ignored). */
export async function setExplorePlaceOrder(
  db: Database,
  context: TenantContext,
  orderedIds: readonly string[],
): Promise<void> {
  assertTenantContext(context);
  await db.transaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      if (!UUID.test(id)) continue;
      await tx
        .update(explorePlaces)
        .set({ sortOrder: (index + 1) * 10 })
        .where(and(eq(explorePlaces.tenantId, context.tenantId), eq(explorePlaces.id, id)));
    }
  });
}
