/**
 * Separate status dimensions of an online check-in (ADR 0021).
 *
 * Every dimension stands on its own; there is deliberately no overall "verified". What each
 * one can and cannot say:
 *
 * | dimension          | highest value          | does NOT mean                                   |
 * |--------------------|------------------------|-------------------------------------------------|
 * | data               | complete               | that the data is true                           |
 * | address            | postally-plausible     | that the guest lives there                      |
 * | age                | declared-adult         | that the guest is of age (only a declaration)   |
 * | email / phone      | verified               | identity – only control of mailbox / number     |
 * | identity           | checked-by-staff       | – (only a person can set it, never the app)     |
 * | legalRegistration  | submitted              | –                                               |
 *
 * `completeness` combines what the policy requires to call the check-in complete (data, age
 * declaration, e-mail confirmation). It is not an access decision: access stays with
 * getAccessForStay and is not changed by any of these statuses.
 */
import { type AddressAssessment } from "../address/address-check";
import { type RegistrationTarget } from "../registration/registration-model";
import { type SyncStatus } from "../registration/registration-sync";
import { type AgeDeclarationStatus } from "../registration/responsible-adult";
import { type BillingKind } from "../billing/billing-address";
import { type BillingPlanAction } from "../billing/billing-transfer";
import { type VatIdStatus } from "../billing/vat-id";
import {
  type ContactVerificationStatus,
  satisfiesRequiredVerification,
} from "../verification/contact-verification";
import { type CheckInValidationPolicy } from "./validation-policy";

export const IDENTITY_CHECK_STATUSES = [
  "not-required",
  "pending-on-site",
  "checked-by-staff",
] as const;
export type IdentityCheckStatus = (typeof IDENTITY_CHECK_STATUSES)[number];

/** Recorded by staff in the admin. No document copy, no document number unless the law asks. */
export type IdentityCheckRecord = {
  checkedByAdminUserId: string;
  checkedAt: Date;
  documentType: "passport" | "id-card" | "other";
};

export const LEGAL_REGISTRATION_STATUSES = [
  "not-required",
  "pending",
  "submitted",
  "failed",
  "manual",
] as const;
export type LegalRegistrationStatus = (typeof LEGAL_REGISTRATION_STATUSES)[number];

export const BILLING_STATUSES = [
  "private",
  "company-pending",
  "company-applied",
  "company-manual",
  "company-failed",
] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

export const COMPLETENESS_BLOCKERS = [
  "data-incomplete",
  "responsible-person-age-missing",
  "responsible-person-under-age",
  "email-not-verified",
] as const;
export type CompletenessBlocker = (typeof COMPLETENESS_BLOCKERS)[number];

export type CheckInStatusInput = {
  policy: CheckInValidationPolicy;
  /** From assessRegistration (required fields of all travellers present and valid). */
  dataComplete: boolean;
  age: AgeDeclarationStatus;
  address: AddressAssessment;
  email: ContactVerificationStatus;
  phone: ContactVerificationStatus;
  identity?: IdentityCheckRecord;
  /** Targets the property syncs to and the current sync rows. */
  legal: {
    formRequired: boolean;
    targets: readonly RegistrationTarget[];
    syncs: readonly { target: RegistrationTarget; status: SyncStatus; implemented: boolean }[];
  };
  billing: {
    kind: BillingKind;
    vatId?: VatIdStatus;
    folioActions?: readonly (BillingPlanAction | "failed")[];
  };
};

export type CheckInStatus = {
  completeness: "complete" | "incomplete";
  blockers: CompletenessBlocker[];
  dimensions: {
    data: "complete" | "incomplete";
    address: AddressAssessment["status"];
    age: AgeDeclarationStatus;
    email: ContactVerificationStatus;
    phone: ContactVerificationStatus;
    identity: IdentityCheckStatus;
    legalRegistration: LegalRegistrationStatus;
    billing: BillingStatus;
    vatId?: VatIdStatus;
  };
};

export function identityCheckStatus(
  policy: CheckInValidationPolicy,
  record: IdentityCheckRecord | undefined,
): IdentityCheckStatus {
  if (record) return "checked-by-staff";
  return policy.identityCheck === "on-site" ? "pending-on-site" : "not-required";
}

export function legalRegistrationStatus(
  input: CheckInStatusInput["legal"],
): LegalRegistrationStatus {
  if (!input.formRequired) return "not-required";
  if (input.targets.length === 0) return "manual";
  const rows = input.targets.map((target) => input.syncs.find((row) => row.target === target));
  // A target without a verified adapter (Feratel today) is handled by staff.
  if (rows.some((row) => row && !row.implemented)) return "manual";
  if (rows.some((row) => row?.status === "failed")) return "failed";
  if (rows.every((row) => row?.status === "synced")) return "submitted";
  return "pending";
}

export function billingStatus(input: CheckInStatusInput["billing"]): BillingStatus {
  if (input.kind === "private") return "private";
  const actions = input.folioActions ?? [];
  if (actions.includes("failed")) return "company-failed";
  if (actions.some((action) => action !== "apply" && action !== "already-applied")) {
    return "company-manual";
  }
  if (actions.length > 0 && actions.every((action) => action === "already-applied")) {
    return "company-applied";
  }
  return "company-pending";
}

export function deriveCheckInStatus(input: CheckInStatusInput): CheckInStatus {
  const blockers: CompletenessBlocker[] = [];
  if (!input.dataComplete) blockers.push("data-incomplete");
  if (input.age === "missing" || input.age === "invalid")
    blockers.push("responsible-person-age-missing");
  if (input.age === "declared-under-age") blockers.push("responsible-person-under-age");
  if (
    input.policy.emailVerification === "required" &&
    !satisfiesRequiredVerification(input.email)
  ) {
    blockers.push("email-not-verified");
  }
  // Address plausibility, phone, identity, legal registration and billing never block
  // completeness: manual addresses and international numbers are always acceptable.
  return {
    completeness: blockers.length === 0 ? "complete" : "incomplete",
    blockers,
    dimensions: {
      data: input.dataComplete ? "complete" : "incomplete",
      address: input.address.status,
      age: input.age,
      email: input.policy.emailVerification === "off" ? "disabled" : input.email,
      phone: input.policy.smsVerification.mode === "off" ? "disabled" : input.phone,
      identity: identityCheckStatus(input.policy, input.identity),
      legalRegistration: legalRegistrationStatus(input.legal),
      billing: billingStatus(input.billing),
      ...(input.billing.kind === "company" && input.billing.vatId
        ? { vatId: input.billing.vatId }
        : {}),
    },
  };
}
