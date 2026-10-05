/**
 * GUIDE content (ADR 0013). Every function requires a TenantContext and filters by
 * `tenant_id` in SQL. Validation of the content itself happens before writing (admin)
 * with the schemas from @up/core; the database enforces the row shape.
 */
import {
  type ContentScope,
  type GuideEntry,
  type GuideStatus,
  isEntityKey,
  type TenantContext,
} from "@up/core";
import { and, asc, eq, isNull, ne, or } from "drizzle-orm";

import { type Database } from "../client";
import { guideSections } from "../schema";

type Row = typeof guideSections.$inferSelect;

export type GuideEntryRecord = GuideEntry & {
  firstPublishedAt?: Date;
  updatedAt: Date;
};

function scopeOf(row: Row): ContentScope {
  if (row.scopeLevel === "unit" && row.propertyId && row.unitId) {
    return { level: "unit", propertyId: row.propertyId, unitId: row.unitId };
  }
  if (row.scopeLevel === "property" && row.propertyId) {
    return { level: "property", propertyId: row.propertyId };
  }
  return { level: "tenant" };
}

function optional<K extends string, V>(key: K, value: V | null): Partial<Record<K, V>> {
  return value === null ? {} : ({ [key]: value } as Record<K, V>);
}

function toRecord(row: Row): GuideEntryRecord {
  const base = {
    id: row.id,
    tenantId: row.tenantId,
    key: row.key,
    status: row.status,
    translationState: row.translationState,
    blocks: row.blocks,
    ...optional("intro", row.intro),
    ...optional("heroImage", row.heroImage),
    ...optional("firstPublishedAt", row.firstPublishedAt),
    updatedAt: row.updatedAt,
  };
  const scope = scopeOf(row);
  if (row.kind === "override" && scope.level === "unit") {
    return { ...base, kind: "override", scope };
  }
  return {
    ...base,
    kind: "topic",
    scope,
    sortOrder: row.sortOrder,
    icon: row.icon ?? "info",
    slug: row.slug ?? {},
    title: row.title ?? {},
    shortDescription: row.shortDescription ?? {},
    ...optional("eyebrow", row.eyebrow),
    ...optional("visibility", row.visibility),
  };
}

function assertTenantContext(context: TenantContext): void {
  if (!isEntityKey(context.tenantId)) throw new TypeError("Invalid tenant context");
}

/**
 * Published entries that can apply to a guest: tenant defaults, the property's topics and
 * the guest's unit entries. Resolution (override by key) happens in @up/core.
 */
export async function listPublishedGuideEntries(
  db: Database,
  context: TenantContext,
  target: { propertyId: string; unitId?: string },
): Promise<GuideEntryRecord[]> {
  assertTenantContext(context);
  if (!isEntityKey(target.propertyId)) return [];
  const unitCondition =
    target.unitId && isEntityKey(target.unitId)
      ? and(eq(guideSections.scopeLevel, "unit"), eq(guideSections.unitId, target.unitId))
      : undefined;
  const rows = await db
    .select()
    .from(guideSections)
    .where(
      and(
        eq(guideSections.tenantId, context.tenantId),
        eq(guideSections.status, "published"),
        or(
          eq(guideSections.scopeLevel, "tenant"),
          and(
            eq(guideSections.propertyId, target.propertyId),
            or(eq(guideSections.scopeLevel, "property"), unitCondition),
          ),
        ),
      ),
    )
    .orderBy(asc(guideSections.sortOrder), asc(guideSections.createdAt));
  return rows.map(toRecord);
}

/** All entries of a property for the admin (archived only on request). */
export async function listGuideEntriesForProperty(
  db: Database,
  context: TenantContext,
  propertyId: string,
  options: { includeArchived?: boolean } = {},
): Promise<GuideEntryRecord[]> {
  assertTenantContext(context);
  if (!isEntityKey(propertyId)) return [];
  const rows = await db
    .select()
    .from(guideSections)
    .where(
      and(
        eq(guideSections.tenantId, context.tenantId),
        eq(guideSections.propertyId, propertyId),
        options.includeArchived ? undefined : ne(guideSections.status, "archived"),
      ),
    )
    .orderBy(asc(guideSections.sortOrder), asc(guideSections.createdAt));
  return rows.map(toRecord);
}

export async function getGuideEntry(
  db: Database,
  context: TenantContext,
  id: string,
): Promise<GuideEntryRecord | undefined> {
  assertTenantContext(context);
  if (!/^[0-9a-f-]{36}$/.test(id)) return undefined;
  const [row] = await db
    .select()
    .from(guideSections)
    .where(and(eq(guideSections.tenantId, context.tenantId), eq(guideSections.id, id)));
  return row ? toRecord(row) : undefined;
}

type ContentFields = Pick<GuideEntry, "intro" | "heroImage" | "blocks">;

export type NewGuideTopic = ContentFields & {
  key: string;
  scope:
    | { level: "property"; propertyId: string }
    | { level: "unit"; propertyId: string; unitId: string };
  sortOrder: number;
  icon: NonNullable<Row["icon"]>;
  slug: NonNullable<Row["slug"]>;
  title: NonNullable<Row["title"]>;
  shortDescription: NonNullable<Row["shortDescription"]>;
  eyebrow?: NonNullable<Row["eyebrow"]>;
  translationState: Row["translationState"];
};

export type NewGuideOverride = ContentFields & {
  key: string;
  scope: { level: "unit"; propertyId: string; unitId: string };
  translationState: Row["translationState"];
};

function scopeColumns(scope: ContentScope) {
  return {
    scopeLevel: scope.level,
    propertyId: scope.level === "tenant" ? null : scope.propertyId,
    unitId: scope.level === "unit" ? scope.unitId : null,
  };
}

function contentColumns(content: ContentFields) {
  return {
    intro: content.intro ?? null,
    heroImage: content.heroImage ?? null,
    blocks: [...content.blocks],
  };
}

export async function createGuideTopic(
  db: Database,
  context: TenantContext,
  topic: NewGuideTopic,
): Promise<GuideEntryRecord> {
  assertTenantContext(context);
  const [row] = await db
    .insert(guideSections)
    .values({
      tenantId: context.tenantId,
      key: topic.key,
      kind: "topic",
      ...scopeColumns(topic.scope),
      status: "draft",
      sortOrder: topic.sortOrder,
      icon: topic.icon,
      slug: topic.slug,
      title: topic.title,
      shortDescription: topic.shortDescription,
      eyebrow: topic.eyebrow ?? null,
      translationState: topic.translationState,
      ...contentColumns(topic),
    })
    .returning();
  if (!row) throw new Error("Guide topic was not created");
  return toRecord(row);
}

export async function createGuideOverride(
  db: Database,
  context: TenantContext,
  override: NewGuideOverride,
): Promise<GuideEntryRecord> {
  assertTenantContext(context);
  const [row] = await db
    .insert(guideSections)
    .values({
      tenantId: context.tenantId,
      key: override.key,
      kind: "override",
      ...scopeColumns(override.scope),
      status: "draft",
      translationState: override.translationState,
      ...contentColumns(override),
    })
    .returning();
  if (!row) throw new Error("Guide override was not created");
  return toRecord(row);
}

export type TopicMetaUpdate = Pick<
  NewGuideTopic,
  "icon" | "slug" | "title" | "shortDescription" | "eyebrow"
>;

/** Updates title, slug, icon … of a topic (never of an override). */
export async function updateGuideTopicMeta(
  db: Database,
  context: TenantContext,
  id: string,
  meta: TopicMetaUpdate,
): Promise<boolean> {
  assertTenantContext(context);
  const updated = await db
    .update(guideSections)
    .set({
      icon: meta.icon,
      slug: meta.slug,
      title: meta.title,
      shortDescription: meta.shortDescription,
      eyebrow: meta.eyebrow ?? null,
    })
    .where(
      and(
        eq(guideSections.tenantId, context.tenantId),
        eq(guideSections.id, id),
        eq(guideSections.kind, "topic"),
      ),
    )
    .returning({ id: guideSections.id });
  return updated.length === 1;
}

/** Updates intro, hero image and blocks of a topic or override. Published → live at once. */
export async function updateGuideContent(
  db: Database,
  context: TenantContext,
  id: string,
  content: ContentFields & { translationState: Row["translationState"] },
): Promise<boolean> {
  assertTenantContext(context);
  const updated = await db
    .update(guideSections)
    .set({ ...contentColumns(content), translationState: content.translationState })
    .where(and(eq(guideSections.tenantId, context.tenantId), eq(guideSections.id, id)))
    .returning({ id: guideSections.id });
  return updated.length === 1;
}

export async function setGuideEntryStatus(
  db: Database,
  context: TenantContext,
  id: string,
  status: GuideStatus,
  now: Date,
): Promise<boolean> {
  assertTenantContext(context);
  const updated = await db
    .update(guideSections)
    .set({ status })
    .where(and(eq(guideSections.tenantId, context.tenantId), eq(guideSections.id, id)))
    .returning({ id: guideSections.id, firstPublishedAt: guideSections.firstPublishedAt });
  const [row] = updated;
  if (row && status === "published" && !row.firstPublishedAt) {
    await db
      .update(guideSections)
      .set({ firstPublishedAt: now })
      .where(and(eq(guideSections.tenantId, context.tenantId), eq(guideSections.id, id)));
  }
  return updated.length === 1;
}

/** Deletes an entry that was never published (otherwise: archive). */
export async function deleteUnpublishedGuideEntry(
  db: Database,
  context: TenantContext,
  id: string,
): Promise<boolean> {
  assertTenantContext(context);
  const deleted = await db
    .delete(guideSections)
    .where(
      and(
        eq(guideSections.tenantId, context.tenantId),
        eq(guideSections.id, id),
        isNull(guideSections.firstPublishedAt),
      ),
    )
    .returning({ id: guideSections.id });
  return deleted.length === 1;
}

/** Writes new sort positions for topics of the tenant (e.g. after moving one up). */
export async function setGuideTopicOrder(
  db: Database,
  context: TenantContext,
  orderedIds: readonly string[],
): Promise<void> {
  assertTenantContext(context);
  await db.transaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(guideSections)
        .set({ sortOrder: (index + 1) * 10 })
        .where(
          and(
            eq(guideSections.tenantId, context.tenantId),
            eq(guideSections.id, id),
            eq(guideSections.kind, "topic"),
          ),
        );
    }
  });
}
