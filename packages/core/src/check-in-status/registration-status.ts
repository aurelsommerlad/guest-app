/**
 * Status dimensions of a stored check-in (ADR 0021) – for the review screen and, later, the
 * admin. Built only from what is stored; nothing here contacts a provider:
 *
 * - address: formally valid at most (no address provider is active – postally plausible
 *   needs Google Places/Address Validation, which is not enabled);
 * - e-mail / phone: no verification sender is active yet → "none" / "disabled";
 * - identity: from the property policy (staff check on site), never from data;
 * - legal registration: whether the template requires a form; sync rows come with F5.
 */
import { assessAddress } from "../address/address-check";
import { checkVatIdFormat, type VatIdStatus, vatIdStatus } from "../billing/vat-id";
import { legalTemplate, registrationFormRequired } from "../registration/legal-templates";
import {
  type GuestRegistration,
  type PropertyRegistrationConfig,
} from "../registration/registration-model";
import { assessRegistration } from "../registration/registration-rules";
import { responsibleAdultStatus } from "../registration/responsible-adult";
import { type ContactVerificationStatus } from "../verification/contact-verification";
import { type CheckInStatus, deriveCheckInStatus } from "./check-in-status";
import { DEFAULT_CHECK_IN_VALIDATION_POLICY } from "./validation-policy";

/** Stored VAT ids passed the format check on save; VIES is not queried (no external call). */
function storedVatStatus(vatId: string | undefined): VatIdStatus {
  const status = vatIdStatus(vatId ? checkVatIdFormat(vatId) : undefined);
  return status === "format-invalid" ? "not-provided" : status;
}

export function registrationStatus(
  config: PropertyRegistrationConfig,
  registration: Pick<GuestRegistration, "status" | "guestCount" | "guests" | "billing">,
  arrivalDate: string,
  contacts: { email?: ContactVerificationStatus; phone?: ContactVerificationStatus } = {},
): CheckInStatus {
  const policy = config.validation ?? {
    ...DEFAULT_CHECK_IN_VALIDATION_POLICY,
    emailVerification: "off" as const,
    companyBilling: false,
  };
  const assessment = assessRegistration(config, registration, arrivalDate);
  const primary = registration.guests.find((guest) => guest.position === 0)?.data ?? {};
  const billing = registration.billing;
  return deriveCheckInStatus({
    policy,
    dataComplete:
      assessment.steps.guests !== "incomplete" && assessment.steps.address !== "incomplete",
    age: responsibleAdultStatus(primary.birthDate, arrivalDate, policy.responsibleAdultMinAge),
    address: assessAddress({
      ...(primary.street ? { street: primary.street } : {}),
      ...(primary.postalCode ? { postalCode: primary.postalCode } : {}),
      ...(primary.city ? { city: primary.city } : {}),
      ...(primary.country ? { country: primary.country } : {}),
    }),
    email: contacts.email ?? "none",
    phone: contacts.phone ?? "none",
    legal: {
      formRequired: config.legalTemplate
        ? registrationFormRequired(legalTemplate(config.legalTemplate), primary.nationality)
        : false,
      targets: config.targets,
      syncs: [],
    },
    billing:
      billing?.kind === "company"
        ? { kind: "company", vatId: storedVatStatus(billing.vatId) }
        : { kind: "private" },
  });
}
