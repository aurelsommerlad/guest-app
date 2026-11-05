/**
 * Validation policy of the online check-in per property (ADR 0021). Stored next to the
 * registration configuration from C2 on; C1 only defines and validates it – no property uses
 * it yet, existing check-ins are unchanged.
 */
import { z } from "zod";

import { DEFAULT_RESPONSIBLE_ADULT_MIN_AGE } from "../registration/responsible-adult";
import { SHARED_ADDRESS_POLICIES } from "../registration/shared-address";
import {
  DEFAULT_SMS_VERIFICATION,
  smsVerificationConfigSchema,
} from "../verification/contact-verification";

export const checkInValidationPolicySchema = z.strictObject({
  /** Main guest's e-mail must be confirmed by code (or waived by staff) for "complete". */
  emailVerification: z.enum(["required", "optional", "off"]),
  /** Prepared only; cannot be made mandatory yet. */
  smsVerification: smsVerificationConfigSchema,
  responsibleAdultMinAge: z.number().int().min(16).max(21),
  sharedAddress: z.enum(SHARED_ADDRESS_POLICIES),
  /** Address suggestions (Google Places) – manual entry always remains possible. */
  addressSuggestions: z.enum(["off", "google-places"]),
  /** Whether staff checks an identity document on site. Never done by the app. */
  identityCheck: z.enum(["not-required", "on-site"]),
  /** Company invoice recipient offered in the check-in. */
  companyBilling: z.boolean(),
  /** Handing the company recipient to the PMS folio. Off until explicitly approved (C7). */
  billingWriteBack: z.literal(false),
});
export type CheckInValidationPolicy = z.infer<typeof checkInValidationPolicySchema>;

/** Target defaults decided on 2026-11-05 (ADR 0021). */
export const DEFAULT_CHECK_IN_VALIDATION_POLICY: CheckInValidationPolicy = {
  emailVerification: "required",
  smsVerification: DEFAULT_SMS_VERIFICATION,
  responsibleAdultMinAge: DEFAULT_RESPONSIBLE_ADULT_MIN_AGE,
  sharedAddress: "allowed",
  addressSuggestions: "google-places",
  identityCheck: "not-required",
  companyBilling: true,
  billingWriteBack: false,
};
