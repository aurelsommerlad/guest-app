/**
 * Unified Inbox – admin side (ADR 0023). Framework-free: every action first checks the
 * permission with `can()` for the conversation's property (first gate); the repository then
 * runs with the admin's RLS scope (second gate). Nothing here talks to a real channel: in
 * I2 replies go to the simulated channel only.
 */
import {
  type AdminPermission,
  type AdminPrincipal,
  can,
  type ConversationChannel,
  type ConversationStatus,
  hasAllProperties,
  isConversationStatus,
  principalHas,
} from "@up/core";
import {
  addInternalNote,
  assignConversation,
  type ConversationDetail,
  type Database,
  deliverSimulatedJobs,
  ensureSimulatedChannelAccount,
  getConversationDetail,
  type InboxScope,
  listAdminUserGrants,
  listAdminUsers,
  queueReply,
  recordInboundMessage,
  setConversationStatus,
  systemInboxScope,
} from "@up/db";

import { type AdminContext } from "../auth/admin-auth-service";
import { principalOf } from "../auth/authorization";
import { simulatedScenarios } from "./simulation";

export type InboxDeps = {
  db: Database;
  /** INBOX_SIMULATION=on (local/staging only). */
  simulation: boolean;
  now: () => Date;
};

export type ActionResult = { ok: true } | { ok: false; error: string };

const NO_ACCESS = "Dafür fehlt Dir die Berechtigung.";
const NOT_FOUND = "Diese Unterhaltung gibt es nicht oder sie ist für Dich nicht sichtbar.";
const CONFLICT = "Die Unterhaltung wurde inzwischen geändert. Bitte lade sie neu.";

/** RLS scope of an admin request – undefined without inbox.read. */
export function inboxScopeFor(admin: AdminContext): InboxScope | undefined {
  const principal = principalOf(admin);
  if (!principalHas(principal, "inbox.read")) return undefined;
  return {
    tenantId: admin.tenantId,
    actor: "staff",
    adminUserId: admin.adminUserId,
    allProperties: hasAllProperties(principal),
    propertyIds: hasAllProperties(principal) ? [] : principal.propertyIds,
    canReadNotes: principalHas(principal, "inbox.notes"),
  };
}

async function conversationFor(
  deps: InboxDeps,
  admin: AdminContext,
  conversationId: string,
  permission: AdminPermission,
): Promise<{ error: string } | { scope: InboxScope; detail: ConversationDetail }> {
  const scope = inboxScopeFor(admin);
  if (!scope) return { error: NO_ACCESS };
  const detail = await getConversationDetail(deps.db, scope, conversationId);
  if (!detail) return { error: NOT_FOUND };
  const propertyId = detail.conversation.propertyId;
  const allowed = propertyId
    ? can(principalOf(admin), permission, { propertyId })
    : can(principalOf(admin), permission) && hasAllProperties(principalOf(admin));
  if (!allowed) return { error: NO_ACCESS };
  return { scope, detail };
}

export async function replyToConversation(
  deps: InboxDeps,
  admin: AdminContext,
  input: { conversationId: string; text: string; clientMessageId: string },
): Promise<ActionResult> {
  const found = await conversationFor(deps, admin, input.conversationId, "inbox.reply");
  if ("error" in found) return { ok: false, error: found.error };
  if (found.detail.conversation.channelEnvironment !== "simulated") {
    // I2: only the simulated channel is wired. Real channels follow in I5–I7 after approval.
    return { ok: false, error: "Dieser Kanal ist noch nicht für Antworten freigeschaltet." };
  }
  const result = await queueReply(deps.db, found.scope, { ...input, now: deps.now() });
  if (!result.ok)
    return {
      ok: false,
      error:
        result.reason === "invalid"
          ? "Bitte eine Nachricht mit höchstens 8000 Zeichen eingeben."
          : NOT_FOUND,
    };
  await deliverSimulatedJobs(deps.db, systemInboxScope(admin.tenantId), deps.now());
  return { ok: true };
}

export async function addNoteToConversation(
  deps: InboxDeps,
  admin: AdminContext,
  input: { conversationId: string; text: string; clientMessageId: string },
): Promise<ActionResult> {
  const found = await conversationFor(deps, admin, input.conversationId, "inbox.notes");
  if ("error" in found) return { ok: false, error: found.error };
  const result = await addInternalNote(deps.db, found.scope, input);
  return result.ok
    ? { ok: true }
    : { ok: false, error: "Bitte eine Notiz mit höchstens 4000 Zeichen eingeben." };
}

export async function changeConversationStatus(
  deps: InboxDeps,
  admin: AdminContext,
  input: { conversationId: string; status: string; expectedStatus: string },
): Promise<ActionResult> {
  if (!isConversationStatus(input.status) || !isConversationStatus(input.expectedStatus))
    return { ok: false, error: "Unbekannter Status." };
  const found = await conversationFor(deps, admin, input.conversationId, "inbox.assign");
  if ("error" in found) return { ok: false, error: found.error };
  const result = await setConversationStatus(deps.db, found.scope, {
    conversationId: input.conversationId,
    status: input.status,
    expectedStatus: input.expectedStatus,
  });
  return result.ok ? { ok: true } : { ok: false, error: CONFLICT };
}

export type TeamMemberOption = { id: string; label: string };

/** Staff members who may reply in a property (assignment targets). */
export async function assignableMembers(
  deps: InboxDeps,
  admin: AdminContext,
  propertyId: string | null,
): Promise<TeamMemberOption[]> {
  const members = await listAdminUsers(deps.db, { tenantId: admin.tenantId });
  const result: TeamMemberOption[] = [];
  for (const member of members) {
    if (member.status !== "active") continue;
    const principal: AdminPrincipal = {
      role: member.role,
      propertyScope: member.propertyScope,
      propertyIds: member.propertyIds,
      grants: await listAdminUserGrants(deps.db, { tenantId: admin.tenantId }, member.id),
    };
    const ok = propertyId
      ? can(principal, "inbox.reply", { propertyId })
      : hasAllProperties(principal) && can(principal, "inbox.reply");
    if (ok) result.push({ id: member.id, label: member.displayName ?? member.email });
  }
  return result;
}

export async function assignConversationTo(
  deps: InboxDeps,
  admin: AdminContext,
  input: {
    conversationId: string;
    assigneeAdminUserId: string | null;
    expectedAssigneeAdminUserId: string | null;
  },
): Promise<ActionResult> {
  const found = await conversationFor(deps, admin, input.conversationId, "inbox.assign");
  if ("error" in found) return { ok: false, error: found.error };
  if (input.assigneeAdminUserId) {
    const options = await assignableMembers(deps, admin, found.detail.conversation.propertyId);
    if (!options.some((option) => option.id === input.assigneeAdminUserId))
      return { ok: false, error: "Diese Person darf in diesem Objekt nicht antworten." };
  }
  const result = await assignConversation(deps.db, found.scope, input);
  return result.ok ? { ok: true } : { ok: false, error: CONFLICT };
}

/**
 * Simulation (INBOX_SIMULATION=on, never production): realistic guest messages from the
 * scenario list for properties the admin manages. Owner/admin only (inbox.manage).
 */
export async function simulateGuestMessages(
  deps: InboxDeps,
  admin: AdminContext,
  input: { propertyIds: readonly string[]; count?: number },
): Promise<ActionResult> {
  if (!deps.simulation) return { ok: false, error: "Die Simulation ist hier nicht aktiv." };
  if (!can(principalOf(admin), "inbox.manage")) return { ok: false, error: NO_ACCESS };
  const accountId = await ensureSimulatedChannelAccount(deps.db, { tenantId: admin.tenantId });
  const system = systemInboxScope(admin.tenantId);
  const scenarios = simulatedScenarios(deps.now(), input.propertyIds);
  const selected = input.count ? scenarios.slice(0, input.count) : scenarios;
  for (const scenario of selected) {
    for (const message of scenario.messages) {
      await recordInboundMessage(deps.db, system, {
        channelAccountId: accountId,
        propertyId: scenario.propertyId,
        channel: scenario.channel,
        kind: scenario.kind,
        externalThreadId: scenario.threadId,
        title: scenario.title,
        guestName: scenario.guestName,
        externalMessageId: message.id,
        text: message.text,
        sentAt: message.at,
        ...(scenario.language ? { language: scenario.language } : {}),
        ...(scenario.reservationId
          ? {
              reservation: {
                reservationProvider: "apaleo" as const,
                externalReservationId: scenario.reservationId,
                linkMethod: "simulated" as const,
              },
            }
          : {}),
      });
    }
  }
  return { ok: true };
}

/** Filters from the URL (validated; unknown values are ignored). */
export function parseInboxFilter(params: {
  channel?: string;
  status?: string;
  unread?: string;
  assignee?: string;
}): {
  channel?: ConversationChannel;
  status?: ConversationStatus;
  unreadOnly?: boolean;
  assignee?: "me" | "none";
} {
  const channels: readonly string[] = [
    "stay_chat",
    "booking_com",
    "airbnb",
    "expedia",
    "whatsapp",
    "other",
  ];
  return {
    ...(params.channel && channels.includes(params.channel)
      ? { channel: params.channel as ConversationChannel }
      : {}),
    ...(isConversationStatus(params.status) ? { status: params.status } : {}),
    ...(params.unread === "1" ? { unreadOnly: true } : {}),
    ...(params.assignee === "me" || params.assignee === "none"
      ? { assignee: params.assignee }
      : {}),
  };
}
