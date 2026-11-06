import "server-only";

import { type VerificationEmailSender } from "@up/core";
import {
  ResendEmailSender,
  SevenSmsSender,
  SimulatedEmailSender,
  SimulatedSmsSender,
  VerificationOutbox,
} from "@up/integrations";

import { serverEnv } from "../env/server";

/**
 * Senders of verification codes (ADR 0021). Built only as configured: by default (off) none
 * exists and the check-in offers no code. "resend" / "seven" send real messages and need
 * explicit approval; "simulated" (local only, enforced by the env schema) sends nothing and
 * keeps the messages in an in-memory outbox for end-to-end tests.
 */
const OUTBOX_KEY = Symbol.for("up.guest.verification-outbox");

/** Process-wide outbox (shared by server actions and the local test route). */
export function localVerificationOutbox(): VerificationOutbox | undefined {
  const env = serverEnv;
  if (env.APP_ENV !== "local") return undefined;
  if (env.EMAIL_DELIVERY !== "simulated" && env.SMS_DELIVERY !== "simulated") return undefined;
  const holder = globalThis as { [OUTBOX_KEY]?: VerificationOutbox };
  holder[OUTBOX_KEY] ??= new VerificationOutbox();
  return holder[OUTBOX_KEY];
}

/** Only allow-listed recipients (address or "@domain"), when an allow list is configured. */
function allowListed(sender: VerificationEmailSender, list: string): VerificationEmailSender {
  const entries = list
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return {
    sendVerificationCode: (message) => {
      const to = message.to.toLowerCase();
      const allowed = entries.some((entry) =>
        entry.startsWith("@") ? to.endsWith(entry) : to === entry,
      );
      return allowed
        ? sender.sendVerificationCode(message)
        : Promise.resolve({ ok: false, reason: "rejected" });
    },
  };
}

export function verificationConfig() {
  const env = serverEnv;
  const outbox = localVerificationOutbox();
  let emailSender: VerificationEmailSender | undefined;
  if (env.EMAIL_DELIVERY === "simulated") emailSender = new SimulatedEmailSender(outbox);
  if (env.EMAIL_DELIVERY === "resend" && env.RESEND_API_KEY && env.EMAIL_FROM) {
    emailSender = new ResendEmailSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
  }
  if (emailSender && env.EMAIL_DELIVERY_ALLOWLIST) {
    emailSender = allowListed(emailSender, env.EMAIL_DELIVERY_ALLOWLIST);
  }
  const smsSender =
    env.SMS_DELIVERY === "simulated"
      ? new SimulatedSmsSender(outbox)
      : env.SMS_DELIVERY === "seven" && env.SEVEN_API_KEY && env.SMS_FROM
        ? new SevenSmsSender({ apiKey: env.SEVEN_API_KEY, from: env.SMS_FROM })
        : undefined;
  return {
    ...(env.OTP_PEPPER ? { pepper: env.OTP_PEPPER } : {}),
    email: { mode: env.EMAIL_DELIVERY, ...(emailSender ? { sender: emailSender } : {}) },
    sms: { mode: env.SMS_DELIVERY, ...(smsSender ? { sender: smsSender } : {}) },
  };
}
