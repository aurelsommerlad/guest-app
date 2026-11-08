/**
 * Admin audit log (M1): append-only (`admin_audit_events`, triggers in migration 0018).
 * Details carry ids, states and changed field names – never guest names, e-mail addresses,
 * passwords, tokens or free texts.
 */
import { isEntityKey, type TenantContext } from "@up/core";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";

import { type Database } from "../client";
import { type ADMIN_AUDIT_ACTORS, adminAuditEvents } from "../schema";

export type AdminAuditActorType = (typeof ADMIN_AUDIT_ACTORS)[number];

export type AdminAuditEventInput = {
  actorType: AdminAuditActorType;
  actorAdminId?: string | null;
  propertyId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
};

export type AdminAuditEvent = AdminAuditEventInput & { id: string; createdAt: Date };

/** Keys that must never be written to the audit log (defence in depth). */
const FORBIDDEN_DETAIL_KEYS =
  /(email|e_mail|mail|name|password|token|secret|phone|note|comment|plate)/i;

export function assertSafeAuditDetails(details: Record<string, unknown>): void {
  const visit = (value: unknown, path: string): void => {
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_DETAIL_KEYS.test(key) && key !== "fields" && key !== "changedFields") {
        throw new TypeError(`Audit details must not contain "${path}${key}"`);
      }
      visit(child, `${path}${key}.`);
    }
  };
  visit(details, "");
}

type Executor = Pick<Database, "insert">;

export async function recordAdminAuditEvent(
  db: Executor,
  context: TenantContext,
  event: AdminAuditEventInput,
): Promise<void> {
  if (!isEntityKey(context.tenantId)) throw new TypeError("Invalid tenant context");
  const details = event.details ?? {};
  assertSafeAuditDetails(details);
  await db.insert(adminAuditEvents).values({
    tenantId: context.tenantId,
    propertyId: event.propertyId ?? null,
    actorType: event.actorType,
    actorAdminId: event.actorAdminId ?? null,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    details,
  });
}

/**
 * Latest audit events of the tenant. With `propertyIds` (a property-limited admin) only
 * events of those properties and tenant-wide events without a property are returned.
 */
export async function listAdminAuditEvents(
  db: Database,
  context: TenantContext,
  options: { limit?: number; propertyIds?: readonly string[] } = {},
): Promise<AdminAuditEvent[]> {
  if (!isEntityKey(context.tenantId)) throw new TypeError("Invalid tenant context");
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const scope = options.propertyIds
    ? options.propertyIds.length
      ? or(
          isNull(adminAuditEvents.propertyId),
          inArray(adminAuditEvents.propertyId, [...options.propertyIds]),
        )
      : isNull(adminAuditEvents.propertyId)
    : undefined;
  const rows = await db
    .select()
    .from(adminAuditEvents)
    .where(and(eq(adminAuditEvents.tenantId, context.tenantId), scope))
    .orderBy(desc(adminAuditEvents.createdAt), desc(adminAuditEvents.id))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    actorType: row.actorType,
    actorAdminId: row.actorAdminId,
    propertyId: row.propertyId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    details: row.details,
  }));
}
