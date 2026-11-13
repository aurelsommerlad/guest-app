/**
 * Port for message channels (ADR 0023, ADR 0003). Adapters live in @up/integrations; their
 * DTOs never leave the adapter. The inbox only sees normalized events and declared
 * capabilities, so a new channel (e.g. WhatsApp) needs no change to the inbox or schema.
 */
import {
  type ChannelProvider,
  type ConversationChannel,
  type ConversationKind,
} from "./inbox-model";

export type ChannelCapabilities = {
  attachments: boolean;
  readReceipts: boolean;
  closeThread: boolean;
  /** Booking.com: mark a guest message as "no reply needed". */
  noReplyNeeded: boolean;
  maxLength: number;
  /** WhatsApp: free replies only within this many hours after the last guest message. */
  replyWindowHours: number | null;
  templatesOutsideWindow: boolean;
};

/** Raw inbound request as received by a webhook route (body bytes before JSON parsing). */
export type RawInboundRequest = {
  headers: Readonly<Record<string, string | undefined>>;
  rawBody: string;
  receivedAt: Date;
};

export type InboundVerification =
  | { ok: true; eventKey: string; eventType: string }
  | { ok: false; reason: "signature" | "timestamp" | "malformed" };

export type NormalizedInboundMessage = {
  type: "message";
  externalThreadId: string;
  externalMessageId: string;
  channel: ConversationChannel;
  kind: ConversationKind;
  externalPropertyId: string;
  externalBookingRef?: string;
  senderKind: "guest" | "ota";
  senderName?: string;
  text: string;
  sentAt: Date;
  attachments: readonly { externalId: string; fileName?: string; mimeType?: string }[];
};

export type NormalizedThreadUpdate = {
  type: "thread";
  externalThreadId: string;
  closed?: boolean;
  externalBookingRef?: string;
};

export type NormalizedInboundEvent = NormalizedInboundMessage | NormalizedThreadUpdate;

export type OutboundMessage = {
  clientMessageId: string;
  text: string;
};

export type ConversationRef = {
  externalThreadId: string;
  externalBookingRef?: string;
};

/**
 * sent: accepted (with the channel's message id) · failed: definite, never retried
 * automatically (`retryable: false`) or retryable before anything reached the channel ·
 * uncertain: the request may have arrived – reconcile, never resend blindly.
 */
export type SendResult =
  | { status: "sent"; externalMessageId: string; sentAt: Date }
  | { status: "failed"; code: string; retryable: boolean; retryAfterSeconds?: number }
  | { status: "uncertain"; code: string };

export type ThreadDigest = {
  externalThreadId: string;
  lastMessageAt: Date;
  messageCount: number;
};

export interface ChannelAdapter {
  readonly provider: ChannelProvider;
  readonly capabilities: ChannelCapabilities;
  verifyInbound(request: RawInboundRequest): InboundVerification;
  parseInbound(request: RawInboundRequest): NormalizedInboundEvent[];
  send(target: ConversationRef, message: OutboundMessage): Promise<SendResult>;
  /** Reconciliation (read only): threads changed since a point in time. */
  listChangedSince?(since: Date): Promise<ThreadDigest[]>;
}
