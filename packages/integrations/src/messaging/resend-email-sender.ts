/**
 * Verification e-mails via Resend (ADR 0021, C4) – POST https://api.resend.com/emails with a
 * Bearer key. Only built when explicitly enabled (EMAIL_DELIVERY=resend, approval required).
 *
 * - The challenge id is the Idempotency-Key: a retried request never sends a second mail.
 * - Nothing about the recipient, the code or the provider response body is logged or
 *   returned – only a safe outcome and the provider's message id.
 * - Expected failures are returned, never thrown; requests time out after 10 s.
 */
import {
  type MessageSendResult,
  type VerificationEmailSender,
  type VerificationMessage,
  verificationEmailContent,
} from "@up/core";

export const RESEND_EMAILS_URL = "https://api.resend.com/emails";

export type ResendEmailSenderOptions = {
  apiKey: string;
  /** Verified sender, e.g. "UNIQUE PLACES <check-in@uniqueplaces.de>". */
  from: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export class ResendEmailSender implements VerificationEmailSender {
  readonly #apiKey: string;
  readonly #from: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: ResendEmailSenderOptions) {
    if (!options.apiKey.startsWith("re_")) throw new TypeError("Invalid Resend API key format");
    if (!options.from.includes("@")) throw new TypeError("Invalid sender address");
    this.#apiKey = options.apiKey;
    this.#from = options.from;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async sendVerificationCode(message: VerificationMessage): Promise<MessageSendResult> {
    const content = verificationEmailContent(message);
    let response: Response;
    try {
      response = await this.#fetch(RESEND_EMAILS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
          ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: this.#from,
          to: [message.to],
          subject: content.subject,
          text: content.text,
          html: content.html,
        }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    if (response.status === 429) return { ok: false, reason: "rate-limited" };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: "not-configured" };
    }
    if (response.status >= 500) return { ok: false, reason: "unavailable" };
    if (!response.ok) return { ok: false, reason: "rejected" };
    try {
      const body = (await response.json()) as { id?: unknown };
      return typeof body.id === "string" && body.id.length <= 200
        ? { ok: true, providerMessageId: body.id }
        : { ok: true };
    } catch {
      return { ok: true };
    }
  }
}
