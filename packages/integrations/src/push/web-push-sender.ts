/**
 * Web Push adapter (ADR 0023) behind the PushSender port: VAPID + RFC 8291 encryption via the
 * `web-push` library. The endpoint is a confidential capability URL – it is never logged.
 */
import {
  classifyPushResponse,
  type PushPayload,
  type PushSender,
  type PushSendResult,
  type PushSubscriptionKeys,
} from "@up/core";
import webpush from "web-push";

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

/** Notifications are worthless after a day; iOS needs "high" to show them promptly. */
const OPTIONS = { TTL: 24 * 3600, urgency: "high" as const, timeout: 10_000 };

export class WebPushSender implements PushSender {
  readonly #vapid: VapidConfig;

  constructor(vapid: VapidConfig) {
    this.#vapid = vapid;
  }

  async send(subscription: PushSubscriptionKeys, payload: PushPayload): Promise<PushSendResult> {
    try {
      const response = await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
        {
          ...OPTIONS,
          vapidDetails: {
            subject: this.#vapid.subject,
            publicKey: this.#vapid.publicKey,
            privateKey: this.#vapid.privateKey,
          },
        },
      );
      return classifyPushResponse(response.statusCode);
    } catch (error) {
      const status = (error as { statusCode?: unknown }).statusCode;
      if (typeof status === "number") return classifyPushResponse(status);
      return { status: "failed", code: "network_error", retryable: true };
    }
  }
}

/** For tests and environments without push: records what would have been sent. */
export class SimulatedPushSender implements PushSender {
  readonly sent: { endpointHost: string; payload: PushPayload }[] = [];

  send(subscription: PushSubscriptionKeys, payload: PushPayload): Promise<PushSendResult> {
    this.sent.push({ endpointHost: new URL(subscription.endpoint).host, payload });
    return Promise.resolve({ status: "sent", httpStatus: 201 });
  }
}

/** Creates a VAPID key pair (operations script; the private key goes into the env only). */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
