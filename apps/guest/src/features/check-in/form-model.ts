/**
 * Serializable form definitions for the check-in steps (pure – no React, no i18n).
 * Field names are "g<position>.<field>", e.g. "g0.firstName", "g2.birthDate".
 */
import {
  type BillingFieldIssue,
  CHECK_IN_STEPS,
  type CheckInStep,
  type FieldError,
  type FieldRequirement,
  fieldRequirements,
  missingFields,
  type RegistrationField,
  rulesFor,
  SHARED_ADDRESS_FIELDS,
} from "@up/core";
import { splitPhone } from "@up/core/phone";

import {
  type AddressSource,
  effectiveStepFields,
  type GuestStep,
  sharedAddressOffered,
  stepFields,
  stepPositions,
  storedAddressSource,
} from "./check-in-service";
import { type StayJourney } from "../journey/stay-journey";

export type FieldKind = "text" | "email" | "phone" | "date" | "country" | "document-type";

export type FormFieldDef = {
  name: string;
  field: RegistrationField;
  kind: FieldKind;
  /** Required now (also `aria-required`). */
  required: boolean;
  /**
   * How to label it: "conditional" = may become required by an answer still missing (age,
   * nationality) – never shown as "optional".
   */
  requirement: FieldRequirement;
  autoComplete: string;
  value: string;
  /** Phone only: preselected calling-code country (ISO alpha-2). */
  phoneCountry?: string;
  error?: FieldError["code"];
};

export type GuestFieldset = {
  position: number;
  fields: FormFieldDef[];
  /** All required fields of this step are saved for this person (accordion collapses). */
  complete: boolean;
  /** "Tom Muster" once entered – the collapsed accordion's summary. */
  displayName?: string;
  /** Required fields still missing (shown as "fehlt: Mobilnummer"). */
  missing: RegistrationField[];
  /** Some values came from the booking (PMS) and were not changed yet. */
  prefilled: boolean;
  /**
   * Fellow travellers only, where the property allows it: "same address as the main guest".
   * `checked` → the address fields are hidden and ignored on the server.
   */
  sharedAddress?: { name: string; checked: boolean };
};

/** Address fields that a shared address replaces (for grouping them in the form). */
export const SHARED_ADDRESS_FORM_FIELDS: ReadonlySet<RegistrationField> = new Set(
  SHARED_ADDRESS_FIELDS,
);

const KINDS: Partial<Record<RegistrationField, FieldKind>> = {
  email: "email",
  phone: "phone",
  birthDate: "date",
  nationality: "country",
  country: "country",
  documentType: "document-type",
};

const AUTOCOMPLETE: Partial<Record<RegistrationField, string>> = {
  firstName: "given-name",
  lastName: "family-name",
  email: "email",
  phone: "tel-national",
  birthDate: "bday",
  street: "address-line1",
  postalCode: "postal-code",
  city: "address-level2",
  country: "country",
};

export function fieldName(position: number, field: RegistrationField): string {
  return `g${String(position)}.${field}`;
}

export function buildStepForm(
  journey: StayJourney,
  step: GuestStep,
  feedback?: {
    errors?: Readonly<Record<number, readonly FieldError[]>>;
    values?: Readonly<Record<string, string>>;
  },
): GuestFieldset[] {
  return stepPositions(journey, step).map((position) => {
    const stored =
      journey.registration?.guests.find((guest) => guest.position === position)?.data ?? {};
    const fields = stepFields(journey, step, position);
    const offered = sharedAddressOffered(journey, step, position);
    const sharedName = `g${String(position)}.addressSource`;
    const source: AddressSource = !offered
      ? "own"
      : feedback?.values?.[sharedName] !== undefined
        ? feedback.values[sharedName] === "same-as-primary"
          ? "same-as-primary"
          : "own"
        : storedAddressSource(journey, position);
    const role = position === 0 ? "primary" : "companion";
    const rules = rulesFor(journey.settings.registration, role, stored, journey.arrivalDate);
    // Labels follow what was entered so far – including values echoed after an error.
    const current: Record<string, string> = { ...stored };
    for (const field of fields) {
      const echoed = feedback?.values?.[fieldName(position, field)];
      if (echoed !== undefined && echoed.trim() !== "") current[field] = echoed.trim();
    }
    const requirements = fieldRequirements(
      journey.settings.registration,
      role,
      current,
      journey.arrivalDate,
      fields,
    );
    const displayName = [stored.firstName, stored.lastName].filter(Boolean).join(" ");
    const missing = missingFields(
      rules,
      stored,
      effectiveStepFields(journey, step, position, storedAddressSource(journey, position)),
    );
    const guest = journey.registration?.guests.find((item) => item.position === position);
    // Stored E.164 → calling code + national number; otherwise the guest's own country.
    const phone = stored.phone ? splitPhone(stored.phone) : undefined;
    const phoneCountry =
      phone?.country ??
      stored.country ??
      stored.nationality ??
      journey.settings.registration.country;
    return {
      position,
      complete: missing.length === 0,
      missing,
      prefilled: (guest?.prefilledFields ?? []).some((field) => fields.includes(field)),
      ...(displayName ? { displayName } : {}),
      ...(offered
        ? { sharedAddress: { name: sharedName, checked: source === "same-as-primary" } }
        : {}),
      fields: fields.map((field) => {
        const name = fieldName(position, field);
        const error = feedback?.errors?.[position]?.find((item) => item.field === field)?.code;
        const storedValue = field === "phone" ? phone?.national : stored[field];
        return {
          name,
          field,
          kind: KINDS[field] ?? "text",
          required: requirements[field] === "required",
          requirement: requirements[field],
          // Personal data is only offered to the browser's autofill for the primary guest.
          autoComplete: position === 0 ? (AUTOCOMPLETE[field] ?? "off") : "off",
          value: feedback?.values?.[name] ?? storedValue ?? "",
          ...(field === "phone"
            ? { phoneCountry: feedback?.values?.[`${name}Country`] ?? phoneCountry }
            : {}),
          ...(error ? { error } : {}),
        };
      }),
    };
  });
}

/** FormData → values per position, for exactly the expected positions and fields. */
export function parseStepValues(
  formData: FormData,
  positions: readonly number[],
  fields: (position: number) => readonly RegistrationField[],
): { values: Record<number, Record<string, string>>; echo: Record<string, string> } {
  const values: Record<number, Record<string, string>> = {};
  const echo: Record<string, string> = {};
  for (const position of positions) {
    values[position] = {};
    for (const field of fields(position)) {
      const raw = formData.get(fieldName(position, field));
      if (typeof raw !== "string") continue;
      const value = raw.slice(0, 400);
      values[position][field] = value;
      echo[fieldName(position, field)] = value;
      if (field === "phone") {
        // The calling code travels as "g<position>.phoneCountry".
        const country = formData.get(`${fieldName(position, field)}Country`);
        if (typeof country === "string") {
          values[position]["phoneCountry"] = country.slice(0, 2);
          echo[`${fieldName(position, field)}Country`] = country.slice(0, 2);
        }
      }
    }
  }
  return { values, echo };
}

/** Visible steps (skipped ones removed) with their 1-based number. */
export function visibleSteps(journey: StayJourney): CheckInStep[] {
  return CHECK_IN_STEPS.filter((step) => journey.assessment.steps[step] !== "skipped");
}

export function isCheckInStep(value: string): value is CheckInStep {
  return (CHECK_IN_STEPS as readonly string[]).includes(value);
}

/** Former step URLs (separate main guest / fellow travellers) now lead to "guests". */
export const LEGACY_STEPS: Readonly<Record<string, CheckInStep>> = {
  primary: "guests",
  companions: "guests",
};

/** Names of the billing form's inputs (also the keys `normalizeBillingInput` reads). */
export const BILLING_FORM_FIELDS = [
  "billingKind",
  "companyName",
  "street",
  "postalCode",
  "city",
  "country",
  "vatId",
  "contactFirstName",
  "contactLastName",
] as const;
export type BillingFormField = Exclude<(typeof BILLING_FORM_FIELDS)[number], "billingKind">;

export type BillingFieldDef = {
  name: BillingFormField;
  kind: "text" | "country";
  required: boolean;
  autoComplete: string;
  value: string;
  error?: BillingFieldIssue["code"];
};

export type BillingForm = { kind: "private" | "company"; fields: BillingFieldDef[] };

const BILLING_REQUIRED = new Set<BillingFormField>(["companyName", "street", "city", "country"]);
const BILLING_AUTOCOMPLETE: Record<BillingFormField, string> = {
  companyName: "organization",
  street: "billing address-line1",
  postalCode: "billing postal-code",
  city: "billing address-level2",
  country: "billing country",
  vatId: "off",
  contactFirstName: "off",
  contactLastName: "off",
};

/**
 * The optional company invoice recipient (ADR 0021): separate from the registration address,
 * prefilled from what is stored – never from the main guest's private address.
 */
export function buildBillingForm(
  journey: StayJourney,
  feedback?: { errors?: readonly BillingFieldIssue[]; values?: Readonly<Record<string, string>> },
): BillingForm {
  const billing = journey.registration?.billing;
  const company = billing?.kind === "company" ? billing : undefined;
  const stored: Record<BillingFormField, string | undefined> = {
    companyName: company?.companyName,
    street: company?.street,
    postalCode: company?.postalCode,
    city: company?.city,
    country: company?.country,
    vatId: company?.vatId,
    contactFirstName: company?.contactPerson?.firstName,
    contactLastName: company?.contactPerson?.lastName,
  };
  const errorOf = (name: BillingFormField) =>
    feedback?.errors?.find(
      (issue) =>
        issue.field === name ||
        (issue.field === "contactPerson" &&
          (name === "contactFirstName" || name === "contactLastName")),
    )?.code;
  const kind =
    (feedback?.values?.["billingKind"] ?? billing?.kind) === "company" ? "company" : "private";
  return {
    kind,
    fields: BILLING_FORM_FIELDS.filter(
      (name): name is BillingFormField => name !== "billingKind",
    ).map((name) => {
      const error = errorOf(name);
      return {
        name,
        kind: name === "country" ? "country" : "text",
        required: BILLING_REQUIRED.has(name),
        autoComplete: BILLING_AUTOCOMPLETE[name],
        value: feedback?.values?.[name] ?? stored[name] ?? "",
        ...(error ? { error } : {}),
      };
    }),
  };
}
