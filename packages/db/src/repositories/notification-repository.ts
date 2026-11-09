/**
 * Notification outbox worker side (M4): claim due jobs, record the result with retry/backoff,
 * list for the admin. Slack only; guest channels stay suppressed. No webhook URL is stored.
 */
import { isEntityKey, type TenantContext } from "@up/core";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";

import { type Database } from "../client";
import { notificationOutbox, propertyServiceSettings } from "../schema";
import { recordAdminAuditEvent } from "./audit-repository";

function assertTenantContext(context: TenantContext): void {
  if (!isEntityKey(context.tenantId)) throw new TypeError("Invalid tenant context");
}

/** Minutes until the next attempt after attempt n (1-based); after the last one: failed. */
export const NOTIFICATION_BACKOFF_MINUTES = [1, 5, 15, 60, 240] as const;
/** A job stuck in "sending" longer than this (crashed worker) is retried. */
export const NOTIFICATION_SENDING_TIMEOUT_MS = 10 * 60 * 1000;

export type OutboxJob = typeof notificationOutbox.$inferSelect;

/**
 * Claims up to `limit` due Slack jobs atomically (pending → sending, attempts + 1). Parallel
 * workers never claim the same job (FOR UPDATE SKIP LOCKED). Stuck jobs are released first.
 */
export async function claimDueNotifications(
  db: Database,
  input: { now: Date; limit: number },
): Promise<OutboxJob[]> {
  await db
    .update(notificationOutbox)
    .set({ status: "pending", updatedAt: input.now })
    .where(
      and(
        eq(notificationOutbox.status, "sending"),
        lte(
          notificationOutbox.updatedAt,
          new Date(input.now.getTime() - NOTIFICATION_SENDING_TIMEOUT_MS),
        ),
      ),
    );
  const due = sql`SELECT id FROM notification_outbox
    WHERE status = 'pending' AND channel = 'slack' AND next_attempt_at <= ${input.now.toISOString()}::timestamptz
    ORDER BY next_attempt_at LIMIT ${Math.min(Math.max(input.limit, 1), 100)}
    FOR UPDATE SKIP LOCKED`;
  return db
    .update(notificationOutbox)
    .set({
      status: "sending",
      attempts: sql`${notificationOutbox.attempts} + 1`,
      updatedAt: input.now,
    })
    .where(and(sql`${notificationOutbox.id} IN (${due})`, eq(notificationOutbox.status, "pending")))
    .returning();
}

export async function completeNotification(
  db: Database,
  input:
    | { id: string; outcome: "sent"; deliveryMode: "simulated" | "live"; now: Date }
    | { id: string; outcome: "suppressed"; reason: string; now: Date }
    | { id: string; outcome: "failed"; errorCode: string; retryAt: Date | null; now: Date },
): Promise<void> {
  const where = and(eq(notificationOutbox.id, input.id), eq(notificationOutbox.status, "sending"));
  if (input.outcome === "sent") {
    await db
      .update(notificationOutbox)
      .set({
        status: "sent",
        sentAt: input.now,
        deliveryMode: input.deliveryMode,
        lastErrorCode: null,
        updatedAt: input.now,
      })
      .where(where);
    return;
  }
  if (input.outcome === "suppressed") {
    await db
      .update(notificationOutbox)
      .set({ status: "suppressed", lastErrorCode: input.reason, updatedAt: input.now })
      .where(where);
    return;
  }
  const [row] = await db
    .update(notificationOutbox)
    .set(
      input.retryAt
        ? {
            status: "pending",
            nextAttemptAt: input.retryAt,
            lastErrorCode: input.errorCode,
            updatedAt: input.now,
          }
        : { status: "failed", lastErrorCode: input.errorCode, updatedAt: input.now },
    )
    .where(where)
    .returning();
  if (row && !input.retryAt) {
    // Error log: every finally failed notification is audited (codes only, no content).
    await recordAdminAuditEvent(
      db,
      { tenantId: row.tenantId },
      {
        actorType: "system",
        propertyId: row.propertyId,
        action: "notification.failed",
        entityType: "notification",
        entityId: row.id,
        details: { kind: row.template, attempts: row.attempts, code: input.errorCode },
      },
    );
  }
}

export async function listNotifications(
  db: Database,
  context: TenantContext,
  scope: { propertyIds?: readonly string[]; limit?: number } = {},
): Promise<OutboxJob[]> {
  assertTenantContext(context);
  return db
    .select()
    .from(notificationOutbox)
    .where(
      and(
        eq(notificationOutbox.tenantId, context.tenantId),
        eq(notificationOutbox.channel, "slack"),
        scope.propertyIds
          ? inArray(notificationOutbox.propertyId, [...scope.propertyIds, "-"])
          : undefined,
      ),
    )
    .orderBy(desc(notificationOutbox.createdAt))
    .limit(Math.min(Math.max(scope.limit ?? 100, 1), 500));
}

export type SlackPropertySettings = { slackRoute: string | null; slackDecisionUpdates: boolean };

export async function getSlackSettings(
  db: Database,
  context: TenantContext,
  propertyId: string,
): Promise<SlackPropertySettings> {
  assertTenantContext(context);
  const [row] = await db
    .select({
      slackRoute: propertyServiceSettings.slackRoute,
      slackDecisionUpdates: propertyServiceSettings.slackDecisionUpdates,
    })
    .from(propertyServiceSettings)
    .where(
      and(
        eq(propertyServiceSettings.tenantId, context.tenantId),
        eq(propertyServiceSettings.propertyId, propertyId),
      ),
    );
  return row ?? { slackRoute: null, slackDecisionUpdates: false };
}

const ROUTE = /^[a-z0-9-]{1,40}$/;

export async function saveSlackSettings(
  db: Database,
  context: TenantContext,
  input: SlackPropertySettings & { propertyId: string; actorAdminId: string; now: Date },
): Promise<{ ok: true } | { ok: false; reason: "invalid-route" }> {
  assertTenantContext(context);
  if (input.slackRoute !== null && !ROUTE.test(input.slackRoute))
    return { ok: false, reason: "invalid-route" };
  await db.transaction(async (tx) => {
    await tx
      .insert(propertyServiceSettings)
      .values({
        tenantId: context.tenantId,
        propertyId: input.propertyId,
        slackRoute: input.slackRoute,
        slackDecisionUpdates: input.slackDecisionUpdates,
        updatedBy: input.actorAdminId,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [propertyServiceSettings.tenantId, propertyServiceSettings.propertyId],
        set: {
          slackRoute: input.slackRoute,
          slackDecisionUpdates: input.slackDecisionUpdates,
          updatedBy: input.actorAdminId,
          updatedAt: input.now,
        },
      });
    await recordAdminAuditEvent(tx, context, {
      actorType: "admin",
      actorAdminId: input.actorAdminId,
      propertyId: input.propertyId,
      action: "settings.slack_updated",
      entityType: "property_service_settings",
      entityId: input.propertyId,
      details: { routeSet: input.slackRoute !== null, decisionUpdates: input.slackDecisionUpdates },
    });
  });
  return { ok: true };
}
