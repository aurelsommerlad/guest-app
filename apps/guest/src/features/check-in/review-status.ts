/**
 * What the review screen shows about the check-in's separate status dimensions (ADR 0021) –
 * shared by both designs. Built only from what is stored; no provider is contacted. The
 * wording keys deliberately distinguish "Angabe" (declared) from "geprüft" (checked): an
 * entered birth date or address is never presented as verified.
 */
import {
  type BillingChoice,
  type ContactVerificationStatus,
  hasBillingStep,
  registrationStatus,
} from "@up/core";

import { type StayJourney } from "../journey/stay-journey";

export type ReviewStatusRow = {
  id: "data" | "age" | "address" | "email" | "phone" | "identity" | "legal" | "billing";
  /** Translation key below "checkIn.status.values". */
  value: string;
  /** Something the guest or the team still has to do (shown muted, never as an error). */
  open: boolean;
};

export function reviewStatusRows(
  journey: StayJourney,
  /** Stored verification state (C4/C5); without it an entered value counts as unconfirmed. */
  verification: { email?: ContactVerificationStatus; phone?: ContactVerificationStatus } = {},
): ReviewStatusRow[] {
  const registration = journey.registration;
  if (!registration) return [];
  const config = journey.settings.registration;
  const primary = registration.guests.find((guest) => guest.position === 0)?.data ?? {};
  // A value that is asked to be confirmed but has no code yet reads "Bestätigung ausstehend".
  const emailVerification = config.validation?.emailVerification ?? "off";
  const storedEmail = verification.email ?? "none";
  const email: ContactVerificationStatus =
    primary.email && emailVerification !== "off" && storedEmail === "none"
      ? "pending"
      : storedEmail;
  const phone: ContactVerificationStatus = primary.phone
    ? (verification.phone ?? "disabled")
    : "none";
  const status = registrationStatus(config, registration, journey.arrivalDate, { email, phone });
  const d = status.dimensions;
  const rows: ReviewStatusRow[] = [
    { id: "data", value: `data.${d.data}`, open: d.data !== "complete" },
  ];
  if (config.validation)
    rows.push({ id: "age", value: `age.${d.age}`, open: d.age !== "declared-adult" });
  if (primary.street || primary.city || primary.country) {
    rows.push({ id: "address", value: `address.${d.address}`, open: false });
  }
  rows.push({
    id: "email",
    value: primary.email ? `email.${d.email}` : "email.not-provided",
    open: d.email === "pending" || d.email === "locked",
  });
  if (primary.phone) rows.push({ id: "phone", value: `phone.${d.phone}`, open: false });
  rows.push({
    id: "identity",
    value: `identity.${d.identity}`,
    open: d.identity === "pending-on-site",
  });
  rows.push({
    id: "legal",
    value: `legal.${d.legalRegistration}`,
    open: d.legalRegistration === "pending" || d.legalRegistration === "manual",
  });
  if (hasBillingStep(config)) {
    rows.push({ id: "billing", value: `billing.${d.billing}`, open: false });
  }
  return rows;
}

/** The stored invoice recipient as label/value rows (empty for the private default). */
export function billingRows(
  billing: BillingChoice | undefined,
  countryName: (code: string) => string,
): { id: string; value: string }[] {
  if (billing?.kind !== "company") return [];
  const rows: { id: string; value: string }[] = [
    { id: "companyName", value: billing.companyName },
    { id: "street", value: billing.street },
    {
      id: "city",
      value: [billing.postalCode, billing.city].filter(Boolean).join(" "),
    },
    { id: "country", value: countryName(billing.country) },
  ];
  if (billing.vatId) rows.push({ id: "vatId", value: billing.vatId });
  if (billing.contactPerson) {
    rows.push({
      id: "contactPerson",
      value: `${billing.contactPerson.firstName} ${billing.contactPerson.lastName}`,
    });
  }
  return rows;
}
