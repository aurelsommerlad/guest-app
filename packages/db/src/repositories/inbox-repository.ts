/**
 * Unified Inbox repository (ADR 0023). Every query runs inside `withInboxScope`: a transaction
 * that sets the tenant/property/notes settings of the checked admin context and switches to
 * the role `stay_inbox`, whose RLS policies (migration 0023) only let rows of that tenant and
 * those properties through. The server-side permission check (`can()`) stays the first gate;
 * RLS is the second one that holds even if a query forgets a filter.
 */
import {
  type ConversationChannel,
  type ConversationEventType,
  type ConversationKind,
  type ConversationStatus,
  isEntityKey,
  MESSAGE_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  type PushDeliveryKind,
  type PushDeliveryStatus,
  type PushRevokeReason,
  type ReservationLinkMethod,
  statusAfterInbound,
  statusAfterReply,
  type TenantContext,
} from "@up/core";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { type Database } from "../client";
import {
  adminUserGrants,
  channelAccounts,
  conversationEvents,
  conversationMessages,
  conversationParticipants,
  conversationReads,
  conversationReservationLinks,
  conversations,
  messageDeliveryJobs,
  pushDeliveries,
  pushSubscriptions,
} from "../schema";
import { recordAdminAuditEvent } from "./audit-repository";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InboxScope = {
  tenantId: string;
  /** staff: an admin request · system: webhook processing, delivery, push dispatch. */
  actor: "staff" | "system";
  adminUserId?: string;
  allProperties: boolean;
  propertyIds: readonly string[];
  /** inbox.notes – internal notes are invisible (also in the database) without it. */
  canReadNotes: boolean;
};

/** System context of one tenant (all properties, notes visible, all push devices). */
export function systemInboxScope(tenantId: string): InboxScope {
  return { tenantId, actor: "system", allProperties: true, propertyIds: [], canReadNotes: true };
}

function assertScope(scope: InboxScope): void {
  if (!isEntityKey(scope.tenantId)) throw new TypeError("Invalid inbox scope (tenant)");
  if (scope.propertyIds.some((id) => !isEntityKey(id)))
    throw new TypeError("Invalid inbox scope (property)");
  if (scope.adminUserId !== undefined && !UUID.test(scope.adminUserId))
    throw new TypeError("Invalid inbox scope (admin user)");
  if (scope.actor === "staff" && scope.adminUserId === undefined)
    throw new TypeError("Invalid inbox scope (staff without admin user)");
}

/** Runs `fn` with the RLS settings of `scope` and the role stay_inbox (transaction-local). */
export async function withInboxScope<T>(
  db: Database,
  scope: InboxScope,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  assertScope(scope);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.tenant_id', ${scope.tenantId}, true),
      set_config('app.property_ids', ${scope.propertyIds.join(",")}, true),
      set_config('app.all_properties', ${scope.allProperties ? "on" : "off"}, true),
      set_config('app.can_read_notes', ${scope.canReadNotes ? "on" : "off"}, true),
      set_config('app.admin_user_id', ${scope.adminUserId ?? ""}, true),
      set_config('app.actor', ${scope.actor}, true)`);
    await tx.execute(sql`set local role stay_inbox`);
    return fn(tx);
  });
}

function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current && typeof current === "object") {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}…` : flat;
}

async function addEvent(
  tx: Tx,
  scope: InboxScope,
  conversationId: string,
  type: ConversationEventType,
  details: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  await tx.insert(conversationEvents).values({
    tenantId: scope.tenantId,
    conversationId,
    type,
    actorKind: scope.actor === "staff" ? "staff" : "system",
    actorAdminUserId: scope.actor === "staff" ? (scope.adminUserId ?? null) : null,
    details,
  });
}

/* ------------------------------------------------------------------ list & detail */

export type ConversationListFilter = {
  propertyId?: string;
  channel?: ConversationChannel;
  status?: ConversationStatus;
  unreadOnly?: boolean;
  assignee?: "me" | "none";
  limit?: number;
};

export type ConversationListItem = {
  id: string;
  propertyId: string | null;
  channel: ConversationChannel;
  kind: ConversationKind;
  title: string;
  status: ConversationStatus;
  priority: "normal" | "high";
  assignedAdminUserId: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  unread: boolean;
  version: number;
  reservationIds: string[];
};

export async function listConversations(
  db: Database,
  scope: InboxScope,
  filter: ConversationListFilter = {},
): Promise<ConversationListItem[]> {
  const me = scope.adminUserId ?? "00000000-0000-0000-0000-000000000000";
  return withInboxScope(db, scope, async (tx) => {
    const unreadExpr = sql<boolean>`(${conversations.lastInboundAt} IS NOT NULL AND ${conversations.lastInboundAt} > coalesce(${conversationReads.lastReadAt}, '-infinity'::timestamptz))`;
    const conditions = [eq(conversations.tenantId, scope.tenantId)];
    if (filter.propertyId) conditions.push(eq(conversations.propertyId, filter.propertyId));
    if (filter.channel) conditions.push(eq(conversations.channel, filter.channel));
    if (filter.status) conditions.push(eq(conversations.status, filter.status));
    if (filter.assignee === "me") conditions.push(eq(conversations.assignedAdminUserId, me));
    if (filter.assignee === "none") conditions.push(isNull(conversations.assignedAdminUserId));
    if (filter.unreadOnly) conditions.push(unreadExpr);
    const rows = await tx
      .select({
        id: conversations.id,
        propertyId: conversations.propertyId,
        channel: conversations.channel,
        kind: conversations.kind,
        title: conversations.title,
        status: conversations.status,
        priority: conversations.priority,
        assignedAdminUserId: conversations.assignedAdminUserId,
        lastMessagePreview: conversations.lastMessagePreview,
        lastMessageAt: conversations.lastMessageAt,
        lastInboundAt: conversations.lastInboundAt,
        version: conversations.version,
        unread: unreadExpr,
      })
      .from(conversations)
      .leftJoin(
        conversationReads,
        and(
          eq(conversationReads.conversationId, conversations.id),
          eq(conversationReads.adminUserId, me),
        ),
      )
      .where(and(...conditions))
      .orderBy(sql`${conversations.lastMessageAt} DESC NULLS LAST`, desc(conversations.createdAt))
      .limit(Math.min(Math.max(filter.limit ?? 100, 1), 300));
    const ids = rows.map((row) => row.id);
    const links = ids.length
      ? await tx
          .select({
            conversationId: conversationReservationLinks.conversationId,
            externalReservationId: conversationReservationLinks.externalReservationId,
          })
          .from(conversationReservationLinks)
          .where(inArray(conversationReservationLinks.conversationId, ids))
      : [];
    return rows.map((row) => ({
      ...row,
      priority: row.priority === "high" ? "high" : "normal",
      unread: row.unread,
      reservationIds: links
        .filter((link) => link.conversationId === row.id)
        .map((link) => link.externalReservationId),
    }));
  });
}

export type ConversationMessageView = {
  id: string;
  direction: "inbound" | "outbound" | "internal";
  origin: string;
  body: string;
  language: string | null;
  authorAdminUserId: string | null;
  senderName: string | null;
  deliveryStatus: string | null;
  deliveryErrorCode: string | null;
  createdAt: Date;
  sentAt: Date | null;
};

export type ConversationDetail = {
  conversation: ConversationListItem & {
    channelAccountId: string;
    guestLanguage: string | null;
    externalClosed: boolean;
    channelProvider: string;
    channelEnvironment: string;
  };
  messages: ConversationMessageView[];
  reservations: {
    reservationProvider: string;
    externalReservationId: string;
    externalBookingRef: string | null;
    linkMethod: string;
    confidence: string;
    propertyId: string;
  }[];
  events: {
    type: string;
    actorAdminUserId: string | null;
    details: Record<string, unknown>;
    createdAt: Date;
  }[];
  /** Other conversations of the same reservation(s) visible to the scope. */
  related: { id: string; channel: ConversationChannel; title: string }[];
};

export async function getConversationDetail(
  db: Database,
  scope: InboxScope,
  conversationId: string,
): Promise<ConversationDetail | undefined> {
  if (!UUID.test(conversationId)) return undefined;
  const me = scope.adminUserId ?? "00000000-0000-0000-0000-000000000000";
  return withInboxScope(db, scope, async (tx) => {
    const [row] = await tx
      .select({
        c: conversations,
        lastReadAt: conversationReads.lastReadAt,
        provider: channelAccounts.provider,
        environment: channelAccounts.environment,
      })
      .from(conversations)
      .innerJoin(
        channelAccounts,
        and(
          eq(channelAccounts.tenantId, conversations.tenantId),
          eq(channelAccounts.id, conversations.channelAccountId),
        ),
      )
      .leftJoin(
        conversationReads,
        and(
          eq(conversationReads.conversationId, conversations.id),
          eq(conversationReads.adminUserId, me),
        ),
      )
      .where(and(eq(conversations.tenantId, scope.tenantId), eq(conversations.id, conversationId)));
    if (!row) return undefined;
    const c = row.c;
    const messages = await tx
      .select({
        id: conversationMessages.id,
        direction: conversationMessages.direction,
        origin: conversationMessages.origin,
        body: conversationMessages.body,
        language: conversationMessages.language,
        authorAdminUserId: conversationMessages.authorAdminUserId,
        senderName: conversationParticipants.displayName,
        deliveryStatus: conversationMessages.deliveryStatus,
        deliveryErrorCode: conversationMessages.deliveryErrorCode,
        createdAt: conversationMessages.createdAt,
        sentAt: conversationMessages.sentAt,
        providerCreatedAt: conversationMessages.providerCreatedAt,
      })
      .from(conversationMessages)
      .leftJoin(
        conversationParticipants,
        and(
          eq(conversationParticipants.tenantId, conversationMessages.tenantId),
          eq(conversationParticipants.id, conversationMessages.senderParticipantId),
        ),
      )
      .where(eq(conversationMessages.conversationId, conversationId))
      .orderBy(
        sql`coalesce(${conversationMessages.providerCreatedAt}, ${conversationMessages.createdAt})`,
        asc(conversationMessages.createdAt),
      );
    const reservations = await tx
      .select({
        reservationProvider: conversationReservationLinks.reservationProvider,
        externalReservationId: conversationReservationLinks.externalReservationId,
        externalBookingRef: conversationReservationLinks.externalBookingRef,
        linkMethod: conversationReservationLinks.linkMethod,
        confidence: conversationReservationLinks.confidence,
        propertyId: conversationReservationLinks.propertyId,
      })
      .from(conversationReservationLinks)
      .where(eq(conversationReservationLinks.conversationId, conversationId));
    const events = await tx
      .select({
        type: conversationEvents.type,
        actorAdminUserId: conversationEvents.actorAdminUserId,
        details: conversationEvents.details,
        createdAt: conversationEvents.createdAt,
      })
      .from(conversationEvents)
      .where(eq(conversationEvents.conversationId, conversationId))
      .orderBy(desc(conversationEvents.createdAt))
      .limit(50);
    const reservationIds = reservations.map((r) => r.externalReservationId);
    const related = reservationIds.length
      ? await tx
          .selectDistinct({
            id: conversations.id,
            channel: conversations.channel,
            title: conversations.title,
          })
          .from(conversationReservationLinks)
          .innerJoin(
            conversations,
            and(
              eq(conversations.tenantId, conversationReservationLinks.tenantId),
              eq(conversations.id, conversationReservationLinks.conversationId),
            ),
          )
          .where(
            and(
              inArray(conversationReservationLinks.externalReservationId, reservationIds),
              sql`${conversations.id} <> ${conversationId}`,
            ),
          )
      : [];
    const unread =
      c.lastInboundAt !== null &&
      (row.lastReadAt === null || c.lastInboundAt.getTime() > row.lastReadAt.getTime());
    return {
      conversation: {
        id: c.id,
        propertyId: c.propertyId,
        channel: c.channel,
        kind: c.kind,
        title: c.title,
        status: c.status,
        priority: c.priority === "high" ? "high" : "normal",
        assignedAdminUserId: c.assignedAdminUserId,
        lastMessagePreview: c.lastMessagePreview,
        lastMessageAt: c.lastMessageAt,
        lastInboundAt: c.lastInboundAt,
        unread,
        version: c.version,
        reservationIds,
        channelAccountId: c.channelAccountId,
        guestLanguage: c.guestLanguage,
        externalClosed: c.externalClosed,
        channelProvider: row.provider,
        channelEnvironment: row.environment,
      },
      messages: messages.map(({ providerCreatedAt, ...m }) => ({
        ...m,
        createdAt: providerCreatedAt ?? m.createdAt,
      })),
      reservations,
      events,
      related,
    };
  });
}

/* ------------------------------------------------------------------ inbound */

export type InboundMessageInput = {
  channelAccountId: string;
  propertyId: string | null;
  channel: ConversationChannel;
  kind: ConversationKind;
  externalThreadId: string;
  title: string;
  guestName: string;
  externalMessageId: string;
  text: string;
  sentAt: Date;
  language?: string;
  reservation?: {
    reservationProvider: "apaleo" | "mock";
    externalReservationId: string;
    externalBookingRef?: string;
    linkMethod: ReservationLinkMethod;
  };
};

/**
 * Stores an inbound guest message idempotently (dedup by thread and message id) and opens
 * the conversation. Returns `created: false` for a duplicate delivery.
 */
export async function recordInboundMessage(
  db: Database,
  scope: InboxScope,
  input: InboundMessageInput,
): Promise<{ conversationId: string; messageId: string | null; created: boolean }> {
  return withInboxScope(db, scope, async (tx) => {
    let [conversation] = await tx
      .select({ id: conversations.id, status: conversations.status })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, scope.tenantId),
          eq(conversations.channelAccountId, input.channelAccountId),
          eq(conversations.externalThreadId, input.externalThreadId),
        ),
      );
    if (!conversation) {
      [conversation] = await tx
        .insert(conversations)
        .values({
          tenantId: scope.tenantId,
          propertyId: input.propertyId,
          channelAccountId: input.channelAccountId,
          channel: input.channel,
          kind: input.kind,
          externalThreadId: input.externalThreadId,
          title: input.title,
          guestLanguage: input.language ?? null,
        })
        .returning({ id: conversations.id, status: conversations.status });
      if (!conversation) throw new Error("conversation insert failed");
      await addEvent(tx, scope, conversation.id, "created", { channel: input.channel });
      if (input.reservation && input.propertyId) {
        await tx.insert(conversationReservationLinks).values({
          tenantId: scope.tenantId,
          conversationId: conversation.id,
          propertyId: input.propertyId,
          reservationProvider: input.reservation.reservationProvider,
          externalReservationId: input.reservation.externalReservationId,
          externalBookingRef: input.reservation.externalBookingRef ?? null,
          linkMethod: input.reservation.linkMethod,
        });
        await addEvent(tx, scope, conversation.id, "reservation_linked", {
          method: input.reservation.linkMethod,
        });
      }
    }
    let [guest] = await tx
      .select({ id: conversationParticipants.id })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversation.id),
          eq(conversationParticipants.kind, "guest"),
        ),
      )
      .limit(1);
    if (!guest) {
      [guest] = await tx
        .insert(conversationParticipants)
        .values({
          tenantId: scope.tenantId,
          conversationId: conversation.id,
          kind: "guest",
          displayName: input.guestName,
        })
        .returning({ id: conversationParticipants.id });
    }
    const [message] = await tx
      .insert(conversationMessages)
      .values({
        tenantId: scope.tenantId,
        conversationId: conversation.id,
        direction: "inbound",
        origin: "guest",
        senderParticipantId: guest?.id ?? null,
        body: input.text.slice(0, MESSAGE_MAX_LENGTH),
        language: input.language ?? null,
        externalMessageId: input.externalMessageId,
        deliveryStatus: "received",
        providerCreatedAt: input.sentAt,
      })
      .onConflictDoNothing({
        target: [
          conversationMessages.tenantId,
          conversationMessages.conversationId,
          conversationMessages.externalMessageId,
        ],
      })
      .returning({ id: conversationMessages.id });
    if (!message) return { conversationId: conversation.id, messageId: null, created: false };
    const next = statusAfterInbound();
    // postgres.js does not serialize Date values inside raw SQL fragments.
    const sentAtText = input.sentAt.toISOString();
    await tx
      .update(conversations)
      .set({
        status: next,
        lastInboundAt: input.sentAt,
        lastMessageAt: sql`greatest(coalesce(${conversations.lastMessageAt}, ${sentAtText}::timestamptz), ${sentAtText}::timestamptz)`,
        lastMessagePreview: preview(input.text),
        externalClosed: false,
        version: sql`${conversations.version} + 1`,
      })
      .where(eq(conversations.id, conversation.id));
    if (conversation.status !== next)
      await addEvent(tx, scope, conversation.id, "status_changed", {
        from: conversation.status,
        to: next,
      });
    return { conversationId: conversation.id, messageId: message.id, created: true };
  });
}

/* ------------------------------------------------------------------ staff actions */

export type ReplyResult =
  | { ok: true; messageId: string; duplicate: boolean }
  | { ok: false; reason: "not_found" | "invalid" };

/** Queues a reply (message + delivery job) idempotently by `clientMessageId`. */
export async function queueReply(
  db: Database,
  scope: InboxScope,
  input: { conversationId: string; text: string; clientMessageId: string; now?: Date },
): Promise<ReplyResult> {
  const text = input.text.trim();
  if (!text || text.length > MESSAGE_MAX_LENGTH || !UUID.test(input.clientMessageId))
    return { ok: false, reason: "invalid" };
  if (!UUID.test(input.conversationId) || !scope.adminUserId)
    return { ok: false, reason: "not_found" };
  const now = input.now ?? new Date();
  return withInboxScope(db, scope, async (tx) => {
    const [conversation] = await tx
      .select({
        id: conversations.id,
        status: conversations.status,
        channelAccountId: conversations.channelAccountId,
      })
      .from(conversations)
      .where(
        and(eq(conversations.tenantId, scope.tenantId), eq(conversations.id, input.conversationId)),
      )
      .for("update");
    if (!conversation) return { ok: false, reason: "not_found" };
    const [existing] = await tx
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.tenantId, scope.tenantId),
          eq(conversationMessages.clientMessageId, input.clientMessageId),
        ),
      );
    if (existing) return { ok: true, messageId: existing.id, duplicate: true };
    const [message] = await tx
      .insert(conversationMessages)
      .values({
        tenantId: scope.tenantId,
        conversationId: conversation.id,
        direction: "outbound",
        origin: "staff",
        authorAdminUserId: scope.adminUserId ?? null,
        body: text,
        clientMessageId: input.clientMessageId,
        deliveryStatus: "queued",
        createdAt: now,
      })
      .returning({ id: conversationMessages.id });
    if (!message) throw new Error("message insert failed");
    await tx.insert(messageDeliveryJobs).values({
      tenantId: scope.tenantId,
      messageId: message.id,
      channelAccountId: conversation.channelAccountId,
      nextAttemptAt: now,
    });
    const next = statusAfterReply(conversation.status);
    await tx
      .update(conversations)
      .set({
        status: next,
        lastOutboundAt: now,
        lastMessageAt: now,
        lastMessagePreview: preview(text),
        version: sql`${conversations.version} + 1`,
      })
      .where(eq(conversations.id, conversation.id));
    await addEvent(tx, scope, conversation.id, "reply_queued", { messageId: message.id });
    if (next !== conversation.status)
      await addEvent(tx, scope, conversation.id, "status_changed", {
        from: conversation.status,
        to: next,
      });
    return { ok: true, messageId: message.id, duplicate: false };
  });
}

/** Internal note: visible to staff with inbox.notes only (RLS rejects it otherwise). */
export async function addInternalNote(
  db: Database,
  scope: InboxScope,
  input: { conversationId: string; text: string; clientMessageId: string },
): Promise<ReplyResult> {
  const text = input.text.trim();
  if (!text || text.length > NOTE_MAX_LENGTH || !UUID.test(input.clientMessageId))
    return { ok: false, reason: "invalid" };
  if (!UUID.test(input.conversationId) || !scope.adminUserId || !scope.canReadNotes)
    return { ok: false, reason: "not_found" };
  return withInboxScope(db, scope, async (tx) => {
    const [conversation] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(eq(conversations.tenantId, scope.tenantId), eq(conversations.id, input.conversationId)),
      );
    if (!conversation) return { ok: false, reason: "not_found" };
    const [message] = await tx
      .insert(conversationMessages)
      .values({
        tenantId: scope.tenantId,
        conversationId: conversation.id,
        direction: "internal",
        origin: "staff",
        authorAdminUserId: scope.adminUserId ?? null,
        body: text,
        clientMessageId: input.clientMessageId,
        deliveryStatus: null,
      })
      .onConflictDoNothing({
        target: [conversationMessages.tenantId, conversationMessages.clientMessageId],
      })
      .returning({ id: conversationMessages.id });
    if (!message) return { ok: true, messageId: "", duplicate: true };
    await addEvent(tx, scope, conversation.id, "note_added", { messageId: message.id });
    return { ok: true, messageId: message.id, duplicate: false };
  });
}

export type UpdateResult =
  { ok: true; version: number } | { ok: false; reason: "conflict" | "not_found" | "invalid" };

/**
 * Status change, guarded by the status the admin saw (`expectedStatus`): it fails only if
 * someone else changed the status meanwhile – replies or notes do not block it.
 */
export async function setConversationStatus(
  db: Database,
  scope: InboxScope,
  input: {
    conversationId: string;
    status: ConversationStatus;
    expectedStatus: ConversationStatus;
  },
): Promise<UpdateResult> {
  if (!UUID.test(input.conversationId)) return { ok: false, reason: "not_found" };
  return withInboxScope(db, scope, async (tx) => {
    const [current] = await tx
      .select({ status: conversations.status, version: conversations.version })
      .from(conversations)
      .where(
        and(eq(conversations.tenantId, scope.tenantId), eq(conversations.id, input.conversationId)),
      )
      .for("update");
    if (!current) return { ok: false, reason: "not_found" };
    if (current.status === input.status) return { ok: true, version: current.version };
    if (current.status !== input.expectedStatus) return { ok: false, reason: "conflict" };
    const [updated] = await tx
      .update(conversations)
      .set({ status: input.status, version: sql`${conversations.version} + 1` })
      .where(eq(conversations.id, input.conversationId))
      .returning({ version: conversations.version });
    if (!updated) return { ok: false, reason: "conflict" };
    await addEvent(tx, scope, input.conversationId, "status_changed", {
      from: current.status,
      to: input.status,
    });
    return { ok: true, version: updated.version };
  });
}

/**
 * Assignment (or unassignment with `assigneeAdminUserId: null`), guarded by the assignee the
 * admin saw (`expectedAssigneeAdminUserId`): a colleague's assignment is never overwritten
 * unseen, while replies or notes in between do not block it.
 */
export async function assignConversation(
  db: Database,
  scope: InboxScope,
  input: {
    conversationId: string;
    assigneeAdminUserId: string | null;
    expectedAssigneeAdminUserId: string | null;
  },
): Promise<UpdateResult> {
  if (!UUID.test(input.conversationId)) return { ok: false, reason: "not_found" };
  for (const id of [input.assigneeAdminUserId, input.expectedAssigneeAdminUserId])
    if (id !== null && !UUID.test(id)) return { ok: false, reason: "invalid" };
  return withInboxScope(db, scope, async (tx) => {
    const [current] = await tx
      .select({ assignee: conversations.assignedAdminUserId, version: conversations.version })
      .from(conversations)
      .where(
        and(eq(conversations.tenantId, scope.tenantId), eq(conversations.id, input.conversationId)),
      )
      .for("update");
    if (!current) return { ok: false, reason: "not_found" };
    if (current.assignee === input.assigneeAdminUserId)
      return { ok: true, version: current.version };
    if (current.assignee !== input.expectedAssigneeAdminUserId)
      return { ok: false, reason: "conflict" };
    const [updated] = await tx
      .update(conversations)
      .set({
        assignedAdminUserId: input.assigneeAdminUserId,
        version: sql`${conversations.version} + 1`,
      })
      .where(eq(conversations.id, input.conversationId))
      .returning({ version: conversations.version });
    if (!updated) return { ok: false, reason: "conflict" };
    await addEvent(
      tx,
      scope,
      input.conversationId,
      input.assigneeAdminUserId ? "assigned" : "unassigned",
      input.assigneeAdminUserId ? { assigneeAdminUserId: input.assigneeAdminUserId } : {},
    );
    return { ok: true, version: updated.version };
  });
}

/** Marks the conversation read for the scope's staff member. */
export async function markConversationRead(
  db: Database,
  scope: InboxScope,
  input: { conversationId: string; at?: Date },
): Promise<void> {
  if (!UUID.test(input.conversationId) || !scope.adminUserId) return;
  const at = input.at ?? new Date();
  await withInboxScope(db, scope, async (tx) => {
    const [visible] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(eq(conversations.tenantId, scope.tenantId), eq(conversations.id, input.conversationId)),
      );
    if (!visible) return;
    await tx
      .insert(conversationReads)
      .values({
        tenantId: scope.tenantId,
        conversationId: input.conversationId,
        adminUserId: scope.adminUserId as string,
        lastReadAt: at,
      })
      .onConflictDoUpdate({
        target: [conversationReads.conversationId, conversationReads.adminUserId],
        set: { lastReadAt: sql`greatest(${conversationReads.lastReadAt}, excluded.last_read_at)` },
      });
  });
}

/** For polling: newest change and unread count among the conversations the scope may see. */
export async function inboxChangeMarker(
  db: Database,
  scope: InboxScope,
): Promise<{ latest: string | null; unread: number }> {
  const me = scope.adminUserId ?? "00000000-0000-0000-0000-000000000000";
  return withInboxScope(db, scope, async (tx) => {
    const [row] = await tx
      .select({
        latest: sql<string | null>`max(${conversations.updatedAt})::text`,
        unread: sql<number>`count(*) filter (where ${conversations.lastInboundAt} > coalesce(${conversationReads.lastReadAt}, '-infinity'::timestamptz))::int`,
      })
      .from(conversations)
      .leftJoin(
        conversationReads,
        and(
          eq(conversationReads.conversationId, conversations.id),
          eq(conversationReads.adminUserId, me),
        ),
      )
      .where(eq(conversations.tenantId, scope.tenantId));
    return { latest: row?.latest ?? null, unread: row?.unread ?? 0 };
  });
}

/* ------------------------------------------------------------------ simulated delivery */

/**
 * Delivers pending jobs of *simulated* channel accounts only (I2): no network. A message
 * whose text contains "[simuliert:fehler]" fails, so the failed state can be shown.
 */
export async function deliverSimulatedJobs(
  db: Database,
  scope: InboxScope,
  now: Date = new Date(),
): Promise<{ sent: number; failed: number }> {
  return withInboxScope(db, scope, async (tx) => {
    const jobs = await tx
      .select({
        jobId: messageDeliveryJobs.id,
        messageId: messageDeliveryJobs.messageId,
        body: conversationMessages.body,
        conversationId: conversationMessages.conversationId,
      })
      .from(messageDeliveryJobs)
      .innerJoin(
        channelAccounts,
        and(
          eq(channelAccounts.tenantId, messageDeliveryJobs.tenantId),
          eq(channelAccounts.id, messageDeliveryJobs.channelAccountId),
        ),
      )
      .innerJoin(
        conversationMessages,
        and(
          eq(conversationMessages.tenantId, messageDeliveryJobs.tenantId),
          eq(conversationMessages.id, messageDeliveryJobs.messageId),
        ),
      )
      .where(
        and(
          eq(messageDeliveryJobs.tenantId, scope.tenantId),
          eq(messageDeliveryJobs.status, "pending"),
          eq(channelAccounts.environment, "simulated"),
        ),
      )
      .for("update", { of: messageDeliveryJobs, skipLocked: true });
    let sent = 0;
    let failed = 0;
    for (const job of jobs) {
      const fail = job.body.includes("[simuliert:fehler]");
      await tx
        .update(messageDeliveryJobs)
        .set({
          status: fail ? "failed" : "sent",
          attempts: sql`${messageDeliveryJobs.attempts} + 1`,
          lastErrorCode: fail ? "simulated_failure" : null,
        })
        .where(eq(messageDeliveryJobs.id, job.jobId));
      await tx
        .update(conversationMessages)
        .set(
          fail
            ? { deliveryStatus: "failed", deliveryErrorCode: "simulated_failure" }
            : { deliveryStatus: "sent", sentAt: now, externalMessageId: `sim-${job.messageId}` },
        )
        .where(eq(conversationMessages.id, job.messageId));
      if (fail) {
        await addEvent(tx, scope, job.conversationId, "message_failed", {
          messageId: job.messageId,
          code: "simulated_failure",
        });
        failed += 1;
      } else sent += 1;
    }
    return { sent, failed };
  });
}

/* ------------------------------------------------------------------ push devices */

export type PushDevice = {
  id: string;
  deviceLabel: string | null;
  userAgentFamily: string | null;
  createdAt: Date;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  failureCount: number;
  revokedAt: Date | null;
  revokedReason: string | null;
};

const deviceColumns = {
  id: pushSubscriptions.id,
  deviceLabel: pushSubscriptions.deviceLabel,
  userAgentFamily: pushSubscriptions.userAgentFamily,
  createdAt: pushSubscriptions.createdAt,
  lastSuccessAt: pushSubscriptions.lastSuccessAt,
  lastFailureAt: pushSubscriptions.lastFailureAt,
  failureCount: pushSubscriptions.failureCount,
  revokedAt: pushSubscriptions.revokedAt,
  revokedReason: pushSubscriptions.revokedReason,
};

/**
 * Registers (or re-activates) the caller's device. A browser subscription that belonged to
 * another staff member on the same device moves to the caller (system context; the browser
 * holds only one subscription per origin).
 */
export async function savePushSubscription(
  db: Database,
  scope: InboxScope,
  input: {
    endpoint: string;
    p256dh: string;
    auth: string;
    deviceLabel?: string;
    userAgentFamily?: string;
  },
): Promise<{ id: string }> {
  const adminUserId = scope.adminUserId;
  if (!adminUserId) throw new TypeError("push subscription needs a staff member");
  const values = {
    tenantId: scope.tenantId,
    adminUserId,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    deviceLabel: input.deviceLabel?.trim() || null,
    userAgentFamily: input.userAgentFamily?.slice(0, 60) ?? null,
  };
  // RLS: a conflicting row of another staff member fails the UPDATE policy (error 42501).
  const own = await withInboxScope(db, scope, async (tx) => {
    const [row] = await tx
      .insert(pushSubscriptions)
      .values(values)
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          p256dh: values.p256dh,
          auth: values.auth,
          deviceLabel: values.deviceLabel,
          userAgentFamily: values.userAgentFamily,
          revokedAt: null,
          revokedReason: null,
          failureCount: 0,
        },
        setWhere: sql`${pushSubscriptions.adminUserId} = ${adminUserId}::uuid AND ${pushSubscriptions.tenantId} = ${scope.tenantId}`,
      })
      .returning({ id: pushSubscriptions.id });
    return row;
  }).catch((error: unknown) => {
    if (pgCode(error) === "42501") return undefined;
    throw error;
  });
  if (own) return own;
  // The endpoint exists for another staff member of this tenant: move it (same device).
  const moved = await withInboxScope(db, systemInboxScope(scope.tenantId), async (tx) => {
    const [row] = await tx
      .update(pushSubscriptions)
      .set({ ...values, revokedAt: null, revokedReason: null, failureCount: 0 })
      .where(
        and(
          eq(pushSubscriptions.endpoint, input.endpoint),
          eq(pushSubscriptions.tenantId, scope.tenantId),
        ),
      )
      .returning({ id: pushSubscriptions.id });
    return row;
  });
  if (!moved) throw new Error("push subscription could not be saved");
  return moved;
}

/** The caller's devices (active first). */
export async function listOwnPushDevices(db: Database, scope: InboxScope): Promise<PushDevice[]> {
  if (!scope.adminUserId) return [];
  return withInboxScope(db, scope, (tx) =>
    tx
      .select(deviceColumns)
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.tenantId, scope.tenantId),
          eq(pushSubscriptions.adminUserId, scope.adminUserId as string),
        ),
      )
      .orderBy(sql`${pushSubscriptions.revokedAt} IS NOT NULL`, desc(pushSubscriptions.createdAt)),
  );
}

/** Keys of one of the caller's active devices (for a test notification). */
export async function getOwnPushKeys(
  db: Database,
  scope: InboxScope,
  subscriptionId: string,
): Promise<{ endpoint: string; p256dh: string; auth: string } | undefined> {
  if (!UUID.test(subscriptionId) || !scope.adminUserId) return undefined;
  return withInboxScope(db, scope, async (tx) => {
    const [row] = await tx
      .select({
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.id, subscriptionId),
          eq(pushSubscriptions.adminUserId, scope.adminUserId as string),
          isNull(pushSubscriptions.revokedAt),
        ),
      );
    return row;
  });
}

export async function revokePushSubscription(
  db: Database,
  scope: InboxScope,
  input: { subscriptionId: string; reason: PushRevokeReason; now?: Date },
): Promise<boolean> {
  if (!UUID.test(input.subscriptionId)) return false;
  return withInboxScope(db, scope, async (tx) => {
    const rows = await tx
      .update(pushSubscriptions)
      .set({ revokedAt: input.now ?? new Date(), revokedReason: input.reason })
      .where(
        and(eq(pushSubscriptions.id, input.subscriptionId), isNull(pushSubscriptions.revokedAt)),
      )
      .returning({ id: pushSubscriptions.id });
    return rows.length > 0;
  });
}

/**
 * Records a push delivery attempt (idempotent per device and dedup key) and updates the
 * device state. Returns false if this dedup key was already delivered to the device.
 */
export async function recordPushDelivery(
  db: Database,
  scope: InboxScope,
  input: {
    subscriptionId: string;
    adminUserId: string;
    kind: PushDeliveryKind;
    dedupKey: string;
    conversationId?: string;
    status: PushDeliveryStatus;
    httpStatus?: number;
    errorCode?: string;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  return withInboxScope(db, scope, async (tx) => {
    const [row] = await tx
      .insert(pushDeliveries)
      .values({
        tenantId: scope.tenantId,
        subscriptionId: input.subscriptionId,
        adminUserId: input.adminUserId,
        kind: input.kind,
        dedupKey: input.dedupKey,
        conversationId: input.conversationId ?? null,
        status: input.status,
        httpStatus: input.httpStatus ?? null,
        errorCode: input.errorCode ?? null,
        purgeAfter: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
        createdAt: now,
      })
      .onConflictDoNothing({ target: [pushDeliveries.subscriptionId, pushDeliveries.dedupKey] })
      .returning({ id: pushDeliveries.id });
    if (!row) return false;
    if (input.status === "sent" || input.status === "simulated") {
      await tx
        .update(pushSubscriptions)
        .set({ lastSuccessAt: now, failureCount: 0 })
        .where(eq(pushSubscriptions.id, input.subscriptionId));
    } else if (input.status === "expired") {
      await tx
        .update(pushSubscriptions)
        .set({ lastFailureAt: now, revokedAt: now, revokedReason: "gone" })
        .where(
          and(eq(pushSubscriptions.id, input.subscriptionId), isNull(pushSubscriptions.revokedAt)),
        );
    } else if (input.status === "failed") {
      await tx
        .update(pushSubscriptions)
        .set({ lastFailureAt: now, failureCount: sql`${pushSubscriptions.failureCount} + 1` })
        .where(eq(pushSubscriptions.id, input.subscriptionId));
    }
    return true;
  });
}

/** Latest push deliveries of the caller (status log for the device page). */
export async function listOwnPushDeliveries(
  db: Database,
  scope: InboxScope,
  limit = 20,
): Promise<
  {
    id: string;
    subscriptionId: string;
    kind: string;
    status: string;
    httpStatus: number | null;
    errorCode: string | null;
    createdAt: Date;
  }[]
> {
  if (!scope.adminUserId) return [];
  return withInboxScope(db, scope, (tx) =>
    tx
      .select({
        id: pushDeliveries.id,
        subscriptionId: pushDeliveries.subscriptionId,
        kind: pushDeliveries.kind,
        status: pushDeliveries.status,
        httpStatus: pushDeliveries.httpStatus,
        errorCode: pushDeliveries.errorCode,
        createdAt: pushDeliveries.createdAt,
      })
      .from(pushDeliveries)
      .where(eq(pushDeliveries.adminUserId, scope.adminUserId as string))
      .orderBy(desc(pushDeliveries.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100)),
  );
}

/* ------------------------------------------------------------------ explicit grants */

/** Explicit extra permissions of an admin (read with the session, owner connection). */
export async function listAdminUserGrants(
  db: Database,
  context: TenantContext,
  adminUserId: string,
): Promise<string[]> {
  if (!UUID.test(adminUserId)) return [];
  const rows = await db
    .select({ permission: adminUserGrants.permission })
    .from(adminUserGrants)
    .where(
      and(
        eq(adminUserGrants.tenantId, context.tenantId),
        eq(adminUserGrants.adminUserId, adminUserId),
      ),
    )
    .orderBy(asc(adminUserGrants.permission));
  return rows.map((row) => row.permission);
}

/** Grants or withdraws an explicit permission (audited). Callers check users.manage first. */
export async function setAdminUserGrant(
  db: Database,
  context: TenantContext,
  input: { adminUserId: string; permission: "inbox.read"; granted: boolean; actorAdminId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    if (input.granted) {
      await tx
        .insert(adminUserGrants)
        .values({
          tenantId: context.tenantId,
          adminUserId: input.adminUserId,
          permission: input.permission,
          grantedByAdminUserId: input.actorAdminId,
        })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(adminUserGrants)
        .where(
          and(
            eq(adminUserGrants.tenantId, context.tenantId),
            eq(adminUserGrants.adminUserId, input.adminUserId),
            eq(adminUserGrants.permission, input.permission),
          ),
        );
    }
    await recordAdminAuditEvent(tx, context, {
      actorType: "admin",
      actorAdminId: input.actorAdminId,
      action: input.granted ? "user.grant_added" : "user.grant_removed",
      entityType: "admin_user",
      entityId: input.adminUserId,
      details: { permission: input.permission },
    });
  });
}

/* ------------------------------------------------------------------ channel accounts */

/** Creates the simulated channel account of a tenant if missing (owner connection; I2). */
export async function ensureSimulatedChannelAccount(
  db: Database,
  context: TenantContext,
): Promise<string> {
  const [existing] = await db
    .select({ id: channelAccounts.id })
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.tenantId, context.tenantId),
        eq(channelAccounts.provider, "simulated"),
        eq(channelAccounts.label, "Simulation"),
      ),
    );
  if (existing) return existing.id;
  const [created] = await db
    .insert(channelAccounts)
    .values({
      tenantId: context.tenantId,
      provider: "simulated",
      label: "Simulation",
      environment: "simulated",
    })
    .returning({ id: channelAccounts.id });
  if (!created) throw new Error("channel account insert failed");
  return created.id;
}
