/**
 * Contact verification status of the main guest (ADR 0021).
 *
 * - Only the main guest. Fellow travellers are never asked for a code.
 * - E-mail: required before the online check-in counts as complete (policy, default on).
 *   Channel relay addresses (…@guest.booking.com) are not accepted as the guest's e-mail at
 *   all, so they can never become "verified".
 * - SMS: prepared, optional, only for supported countries (DE, AT, CH to start). A number from
 *   another country is simply "unsupported-country" – never a reason to block a check-in.
 * - Manual exception: a staff member may waive the e-mail verification with a reason; that is
 *   recorded as "waived", never as "verified".
 */
import { z } from "zod";

import { normalizePhone } from "../contact/phone";
import { isCountryCode } from "../registration/countries";
import { type OtpChannel } from "./otp";

export const CONTACT_VERIFICATION_STATUSES = [
  "none",
  "pending",
  "verified",
  "locked",
  "waived",
  "unsupported-country",
  "disabled",
] as const;
export type ContactVerificationStatus = (typeof CONTACT_VERIFICATION_STATUSES)[number];

export const WAIVER_REASONS = [
  "guest-has-no-own-email",
  /** C5: no reachable mobile number (e.g. landline only, number abroad without SMS). */
  "guest-has-no-reachable-mobile",
  "delivery-failed",
  "confirmed-in-person",
  "other",
] as const;
export type WaiverReason = (typeof WAIVER_REASONS)[number];

/** A logged staff exception. The admin id is the accountable person. */
export const contactWaiverSchema = z
  .strictObject({
    adminUserId: z.string().trim().min(1).max(100),
    reason: z.enum(WAIVER_REASONS),
    note: z
      .string()
      .transform((value) => value.normalize("NFC").replace(/\s+/g, " ").trim())
      .pipe(
        z
          .string()
          .max(300)
          .regex(/^[^\p{Cc}<>]*$/u),
      )
      .optional(),
    at: z.date(),
  })
  .refine((waiver) => waiver.reason !== "other" || (waiver.note ?? "").length >= 5, {
    message: "a note is required for reason 'other'",
    path: ["note"],
  });
export type ContactWaiver = z.infer<typeof contactWaiverSchema>;

/** What is persisted per main guest and channel (C2). */
export type ContactVerificationRecord = {
  channel: OtpChannel;
  /** Hash of the value that was confirmed (contactTargetHash). */
  verifiedTargetHash?: string;
  verifiedAt?: Date;
  /** A pending or locked challenge for the *current* value. */
  openChallenge?: { targetHash: string; status: "pending" | "locked"; expiresAt: Date };
  waiver?: ContactWaiver;
};

export const smsVerificationConfigSchema = z.strictObject({
  /** Prepared only – off until a provider (seven.io) is configured and approved. */
  mode: z.enum(["off", "optional"]),
  supportedCountries: z
    .array(z.string().refine(isCountryCode, "must be an ISO 3166-1 alpha-2 code"))
    .min(1)
    .max(60)
    .refine((list) => new Set(list).size === list.length, "countries must be unique"),
});
export type SmsVerificationConfig = z.infer<typeof smsVerificationConfigSchema>;

export const DEFAULT_SMS_VERIFICATION: SmsVerificationConfig = {
  mode: "off",
  supportedCountries: ["DE", "AT", "CH"],
};

export type SmsAvailability = "available" | "unsupported-country" | "disabled" | "invalid-number";

/** Whether an SMS code may be offered for this (stored, E.164) number. */
export function smsAvailability(e164: string, config: SmsVerificationConfig): SmsAvailability {
  if (config.mode === "off") return "disabled";
  const check = normalizePhone(e164);
  if (!check.ok) return "invalid-number";
  return check.country && config.supportedCountries.includes(check.country)
    ? "available"
    : "unsupported-country";
}

/**
 * Status for the current value. A confirmation belongs to the exact value: once the guest
 * changes the address or number, it no longer counts.
 */
export function contactVerificationStatus(
  record: ContactVerificationRecord | undefined,
  currentTargetHash: string | undefined,
  options: { availability?: SmsAvailability } = {},
): ContactVerificationStatus {
  if (options.availability === "disabled") return "disabled";
  if (currentTargetHash === undefined) return "none";
  if (record?.verifiedTargetHash === currentTargetHash && record.verifiedAt) return "verified";
  if (record?.waiver) return "waived";
  if (options.availability === "unsupported-country") return "unsupported-country";
  if (options.availability === "invalid-number") return "none";
  const open = record?.openChallenge;
  if (open?.targetHash === currentTargetHash) {
    if (open.status === "locked") return "locked";
    return "pending";
  }
  return "none";
}

/** Whether a status satisfies a *required* verification. Waived counts; nothing else does. */
export function satisfiesRequiredVerification(status: ContactVerificationStatus): boolean {
  return status === "verified" || status === "waived";
}

/** How a code was handed over: really sent, only simulated (no provider active) or failed. */
export const VERIFICATION_DELIVERIES = ["sent", "simulated", "failed"] as const;
export type VerificationDelivery = (typeof VERIFICATION_DELIVERIES)[number];

/** Audit trail of contact verification – ids, channels and outcomes only, never values. */
export const CONTACT_VERIFICATION_EVENTS = [
  "code-sent",
  "code-simulated",
  "code-send-failed",
  "code-wrong",
  "code-expired",
  "code-locked",
  "verified",
  "reset-by-change",
  "waived",
  "waiver-revoked",
] as const;
export type ContactVerificationEvent = (typeof CONTACT_VERIFICATION_EVENTS)[number];

export const VERIFICATION_ACTORS = ["guest", "admin", "system"] as const;
export type VerificationActor = (typeof VERIFICATION_ACTORS)[number];
