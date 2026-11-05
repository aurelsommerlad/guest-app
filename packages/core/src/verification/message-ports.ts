/**
 * Ports for verification messages (ADR 0021). Adapters: Resend (e-mail), seven.io (SMS,
 * prepared). Not implemented in C1 – nothing is sent.
 *
 * Rules for every adapter:
 * - the message contains the code and the property name only – no booking details;
 * - no message content, recipient or code is logged; only ids and safe error codes;
 * - expected failures are returned, never thrown.
 */
export type MessageSendResult =
  | { ok: true; providerMessageId?: string }
  | { ok: false; reason: "unavailable" | "rejected" | "rate-limited" | "not-configured" };

export type VerificationMessage = {
  /** Normalised e-mail or E.164 number. */
  to: string;
  code: string;
  locale: "de" | "en";
  propertyName: string;
  /** Minutes until the code expires (for the text). */
  validMinutes: number;
};

export interface VerificationEmailSender {
  sendVerificationCode(message: VerificationMessage): Promise<MessageSendResult>;
}

export interface VerificationSmsSender {
  sendVerificationCode(message: VerificationMessage): Promise<MessageSendResult>;
}
