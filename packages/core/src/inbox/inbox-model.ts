/**
 * Unified Inbox (ADR 0023): channel-independent conversation model. Every channel (STAY guest
 * chat, Channex → Booking.com/Airbnb/Expedia, later WhatsApp) is an adapter behind
 * `ChannelAdapter`; the inbox and the data model never know provider-specific fields.
 */

/** Who delivers a conversation technically (one adapter per provider). */
export const CHANNEL_PROVIDERS = ["stay", "channex", "whatsapp", "simulated"] as const;
export type ChannelProvider = (typeof CHANNEL_PROVIDERS)[number];

/** The guest-facing channel of a conversation (independent of the provider). */
export const CONVERSATION_CHANNELS = [
  "stay_chat",
  "booking_com",
  "airbnb",
  "expedia",
  "whatsapp",
  "other",
] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const CONVERSATION_KINDS = [
  "reservation",
  "inquiry",
  "reservation_request",
  "general",
] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

/** open = answer needed · pending = waiting for the guest/others · done = handled. */
export const CONVERSATION_STATUSES = ["open", "pending", "done"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_DIRECTIONS = ["inbound", "outbound", "internal"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_ORIGINS = [
  "guest",
  "staff",
  "staff_ai_assisted",
  "ai_auto",
  "system",
  "ota_system",
] as const;
export type MessageOrigin = (typeof MESSAGE_ORIGINS)[number];

/**
 * received: inbound, stored · queued/sending: outbound job pending · sent: accepted by the
 * channel · delivered/read: channel confirmed (if supported) · failed: definite error ·
 * uncertain: outcome unknown (timeout after sending) – never retried blindly.
 */
export const DELIVERY_STATUSES = [
  "received",
  "queued",
  "sending",
  "sent",
  "delivered",
  "read",
  "failed",
  "uncertain",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const PARTICIPANT_KINDS = ["guest", "staff", "ai", "system", "ota"] as const;
export type ParticipantKind = (typeof PARTICIPANT_KINDS)[number];

export const RESERVATION_LINK_METHODS = [
  "guest_session",
  "channex_booking",
  "ota_code_match",
  "manual",
  "simulated",
] as const;
export type ReservationLinkMethod = (typeof RESERVATION_LINK_METHODS)[number];

export const CONVERSATION_EVENT_TYPES = [
  "created",
  "status_changed",
  "assigned",
  "unassigned",
  "reservation_linked",
  "reservation_unlinked",
  "note_added",
  "reply_queued",
  "message_failed",
  "message_uncertain",
  "delivery_retried",
  "external_closed",
  "no_reply_needed",
  "attachment_rejected",
] as const;
export type ConversationEventType = (typeof CONVERSATION_EVENT_TYPES)[number];

export const CHANNEL_ACCOUNT_ENVIRONMENTS = ["simulated", "staging", "production"] as const;
export type ChannelAccountEnvironment = (typeof CHANNEL_ACCOUNT_ENVIRONMENTS)[number];

/** Message body limits: a long reply must fit, the database guards the upper bound. */
export const MESSAGE_MAX_LENGTH = 8000;
export const NOTE_MAX_LENGTH = 4000;

/**
 * Status after an inbound guest message: a conversation that waits or is done opens again
 * (the guest wrote, so an answer is needed).
 */
export function statusAfterInbound(): ConversationStatus {
  return "open";
}

/** Status after a staff reply: the ball is with the guest. */
export function statusAfterReply(current: ConversationStatus): ConversationStatus {
  return current === "done" ? "done" : "pending";
}

/** Unread for one staff member: an inbound message newer than their last read mark. */
export function isUnread(lastInboundAt: Date | null, lastReadAt: Date | null): boolean {
  if (!lastInboundAt) return false;
  return !lastReadAt || lastInboundAt.getTime() > lastReadAt.getTime();
}

export function isConversationChannel(value: unknown): value is ConversationChannel {
  return typeof value === "string" && (CONVERSATION_CHANNELS as readonly string[]).includes(value);
}

export function isConversationStatus(value: unknown): value is ConversationStatus {
  return typeof value === "string" && (CONVERSATION_STATUSES as readonly string[]).includes(value);
}
