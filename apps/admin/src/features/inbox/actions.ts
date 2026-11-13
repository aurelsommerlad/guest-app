"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "../auth/server";
import { visibleProperties } from "../auth/authorization";
import { getTenantProperties } from "../property-context/server";
import {
  addNoteToConversation,
  assignConversationTo,
  changeConversationStatus,
  replyToConversation,
  simulateGuestMessages,
} from "./inbox-service";
import { inboxDeps } from "./server";

export type ComposerState =
  { status: "idle" } | { status: "sent"; at: number } | { status: "error"; message: string };

function text(formData: FormData, name: string, max: number): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
}

function conversationPath(conversationId: string): string {
  return `/inbox/c/${encodeURIComponent(conversationId)}`;
}

/** Reply or internal note from the composer (idempotent by clientMessageId). */
export async function sendComposerAction(
  _previous: ComposerState,
  formData: FormData,
): Promise<ComposerState> {
  const admin = await requireAdmin();
  const conversationId = text(formData, "conversationId", 64);
  const input = {
    conversationId,
    text: text(formData, "text", 9000),
    clientMessageId: text(formData, "clientMessageId", 64),
  };
  const result =
    text(formData, "mode", 10) === "note"
      ? await addNoteToConversation(inboxDeps(), admin, input)
      : await replyToConversation(inboxDeps(), admin, input);
  if (!result.ok) return { status: "error", message: result.error };
  revalidatePath("/inbox", "layout");
  return { status: "sent", at: Date.now() };
}

export async function setStatusAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const conversationId = text(formData, "conversationId", 64);
  const result = await changeConversationStatus(inboxDeps(), admin, {
    conversationId,
    status: text(formData, "status", 20),
    expectedStatus: text(formData, "currentStatus", 20),
  });
  revalidatePath("/inbox", "layout");
  redirect(
    `${conversationPath(conversationId)}${result.ok ? "" : `?error=${encodeURIComponent(result.error)}`}`,
  );
}

export async function assignAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const conversationId = text(formData, "conversationId", 64);
  const assignee = text(formData, "assignee", 64);
  const result = await assignConversationTo(inboxDeps(), admin, {
    conversationId,
    assigneeAdminUserId: assignee === "me" ? admin.adminUserId : assignee || null,
    expectedAssigneeAdminUserId: text(formData, "currentAssignee", 64) || null,
  });
  revalidatePath("/inbox", "layout");
  redirect(
    `${conversationPath(conversationId)}${result.ok ? "" : `?error=${encodeURIComponent(result.error)}`}`,
  );
}

/** Local/staging simulation: realistic guest messages for the visible properties. */
export async function simulateMessagesAction(): Promise<void> {
  const admin = await requireAdmin();
  const properties = visibleProperties(admin, await getTenantProperties());
  const result = await simulateGuestMessages(inboxDeps(), admin, {
    propertyIds: properties.map((property) => property.id),
  });
  revalidatePath("/inbox", "layout");
  redirect(
    result.ok ? "/inbox?notice=simulated" : `/inbox?error=${encodeURIComponent(result.error)}`,
  );
}
