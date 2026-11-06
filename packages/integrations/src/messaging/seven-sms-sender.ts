/**
 * Verification SMS via seven.io (ADR 0021, C5 – prepared only). POST
 * https://gateway.seven.io/api/sms with the X-Api-Key header, form-encoded `to`, `text`,
 * `from`; the JSON answer carries `success` ("100" = accepted) and one entry per message.
 *
 * Not used until approved: the app only builds it with SMS_DELIVERY=seven, which no
 * environment sets. `foreign_id` carries the challenge id; recipient, text and code are never
 * logged or returned.
 */
import {
  type MessageSendResult,
  type VerificationMessage,
  type VerificationSmsSender,
  verificationSmsText,
} from "@up/core";

export const SEVEN_SMS_URL = "https://gateway.seven.io/api/sms";

export type SevenSmsSenderOptions = {
  apiKey: string;
  /** Sender id: up to 11 alphanumeric or 16 numeric characters. */
  from: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/** seven.io return codes that mean "this number / content cannot be served" vs. account issues. */
const REJECTED = new Set([
  "101",
  "201",
  "202",
  "301",
  "305",
  "401",
  "407001",
  "407002",
  "407003",
  "407004",
]);
const RATE_LIMITED = new Set(["402", "403", "501"]);
const NOT_CONFIGURED = new Set(["500", "900", "901", "902", "903", "407005"]);

export class SevenSmsSender implements VerificationSmsSender {
  readonly #apiKey: string;
  readonly #from: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: SevenSmsSenderOptions) {
    if (options.apiKey.trim().length < 10) throw new TypeError("Invalid seven.io API key");
    if (!/^([A-Za-z0-9 ]{1,11}|\+?[0-9]{1,16})$/.test(options.from)) {
      throw new TypeError("Invalid SMS sender id");
    }
    this.#apiKey = options.apiKey;
    this.#from = options.from;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async sendVerificationCode(message: VerificationMessage): Promise<MessageSendResult> {
    if (!/^\+[1-9][0-9]{6,14}$/.test(message.to)) return { ok: false, reason: "rejected" };
    const body = new URLSearchParams({
      to: message.to,
      text: verificationSmsText(message),
      from: this.#from,
      // Code validity: the SMS is useless after expiry, so the network may drop it then.
      ttl: String(Math.max(1, message.validMinutes)),
      ...(message.idempotencyKey ? { foreign_id: message.idempotencyKey.slice(0, 64) } : {}),
    });
    let response: Response;
    try {
      response = await this.#fetch(SEVEN_SMS_URL, {
        method: "POST",
        headers: {
          "X-Api-Key": this.#apiKey,
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    if (response.status >= 500) return { ok: false, reason: "unavailable" };
    let code: string | undefined;
    let messageId: string | undefined;
    try {
      const json = (await response.json()) as {
        success?: unknown;
        messages?: { id?: unknown }[];
      };
      code =
        typeof json.success === "string" || typeof json.success === "number"
          ? String(json.success)
          : undefined;
      const id = json.messages?.[0]?.id;
      messageId = typeof id === "string" || typeof id === "number" ? String(id) : undefined;
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    if (code === "100") {
      return messageId ? { ok: true, providerMessageId: messageId } : { ok: true };
    }
    if (code && RATE_LIMITED.has(code)) return { ok: false, reason: "rate-limited" };
    if (code && NOT_CONFIGURED.has(code)) return { ok: false, reason: "not-configured" };
    if (code && REJECTED.has(code)) return { ok: false, reason: "rejected" };
    return { ok: false, reason: "unavailable" };
  }
}
