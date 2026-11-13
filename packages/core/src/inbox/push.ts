/**
 * Web Push for the STAY admin PWA (ADR 0023). Push is an addition, never a delivery
 * guarantee: the inbox works without it. Notifications carry no message content by default.
 */

/** off: nothing is sent · test: only test notifications to the caller's own device · live: automatic notifications (approval required). */
export const PUSH_DELIVERY_MODES = ["off", "test", "live"] as const;
export type PushDeliveryMode = (typeof PUSH_DELIVERY_MODES)[number];

export const PUSH_DELIVERY_KINDS = ["test", "message", "reminder"] as const;
export type PushDeliveryKind = (typeof PUSH_DELIVERY_KINDS)[number];

export const PUSH_DELIVERY_STATUSES = [
  "simulated",
  "sent",
  "failed",
  "expired",
  "skipped",
] as const;
export type PushDeliveryStatus = (typeof PUSH_DELIVERY_STATUSES)[number];

export const PUSH_REVOKE_REASONS = [
  "user",
  "expired",
  "gone",
  "user_disabled",
  "inactive",
] as const;
export type PushRevokeReason = (typeof PUSH_REVOKE_REASONS)[number];

export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };

/** What the service worker shows. `url` is a same-origin path (deep link). */
export type PushPayload = {
  title: string;
  body: string;
  url: string;
  /** Collapses notifications of the same conversation on the device. */
  tag: string;
};

export type PushSendResult =
  | { status: "sent"; httpStatus: number }
  | { status: "expired"; httpStatus: number }
  | { status: "failed"; httpStatus?: number; code: string; retryable: boolean };

export interface PushSender {
  send(subscription: PushSubscriptionKeys, payload: PushPayload): Promise<PushSendResult>;
}

/** Push endpoints are capability URLs of the browser vendors – only https, bounded length. */
export function isValidPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 1000) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Deep links in notifications are same-origin inbox paths only. */
export function inboxConversationPath(conversationId: string): string {
  return `/inbox/c/${encodeURIComponent(conversationId)}`;
}

/** Interpretation of the push service's HTTP status (RFC 8030 / vendor behaviour). */
export function classifyPushResponse(httpStatus: number): PushSendResult {
  if (httpStatus >= 200 && httpStatus < 300) return { status: "sent", httpStatus };
  if (httpStatus === 404 || httpStatus === 410) return { status: "expired", httpStatus };
  if (httpStatus === 429 || httpStatus >= 500)
    return { status: "failed", httpStatus, code: `http_${String(httpStatus)}`, retryable: true };
  return { status: "failed", httpStatus, code: `http_${String(httpStatus)}`, retryable: false };
}

/** Notification text without confidential content (default). */
export function messageNotification(input: {
  conversationId: string;
  channelLabel: string;
  propertyName: string;
}): PushPayload {
  return {
    title: "Neue Gästenachricht",
    body: `${input.channelLabel} · ${input.propertyName}`,
    url: inboxConversationPath(input.conversationId),
    tag: `conversation:${input.conversationId}`,
  };
}
