/**
 * Serializable form definitions for the check-in steps (pure – no React, no i18n).
 * Field names are "g<position>.<field>", e.g. "g0.firstName", "g2.birthDate".
 */
import {
  CHECK_IN_STEPS,
  type CheckInStep,
  type FieldError,
  missingFields,
  type RegistrationField,
  rulesFor,
} from "@up/core";

import { type GuestStep, stepFields, stepPositions } from "./check-in-service";
import { type StayJourney } from "../journey/stay-journey";

export type FieldKind = "text" | "date" | "country" | "document-type";

export type FormFieldDef = {
  name: string;
  field: RegistrationField;
  kind: FieldKind;
  required: boolean;
  autoComplete: string;
  value: string;
  error?: FieldError["code"];
};

export type GuestFieldset = {
  position: number;
  fields: FormFieldDef[];
  /** All required fields of this step are saved for this person (accordion collapses). */
  complete: boolean;
  /** "Tom Muster" once entered – the collapsed accordion's summary. */
  displayName?: string;
};

const KINDS: Partial<Record<RegistrationField, FieldKind>> = {
  birthDate: "date",
  nationality: "country",
  country: "country",
  documentType: "document-type",
};

const AUTOCOMPLETE: Partial<Record<RegistrationField, string>> = {
  firstName: "given-name",
  lastName: "family-name",
  birthDate: "bday",
  street: "address-line1",
  postalCode: "postal-code",
  city: "address-level2",
  country: "country",
};

export function fieldName(position: number, field: RegistrationField): string {
  return `g${String(position)}.${field}`;
}

/** Required for a guest of this role regardless of age (children rules may require less). */
function alwaysRequired(journey: StayJourney, position: number, field: RegistrationField): boolean {
  const config = journey.settings.registration;
  if (position === 0) return config.primaryGuest.required.includes(field);
  const child = config.children?.required ?? config.companions.required;
  return config.companions.required.includes(field) && child.includes(field);
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
    const rules = rulesFor(
      journey.settings.registration,
      position === 0 ? "primary" : "companion",
      stored,
      journey.arrivalDate,
    );
    const displayName = [stored.firstName, stored.lastName].filter(Boolean).join(" ");
    return {
      position,
      complete: missingFields(rules, stored, fields).length === 0,
      ...(displayName ? { displayName } : {}),
      fields: fields.map((field) => {
        const name = fieldName(position, field);
        const error = feedback?.errors?.[position]?.find((item) => item.field === field)?.code;
        return {
          name,
          field,
          kind: KINDS[field] ?? "text",
          required: alwaysRequired(journey, position, field),
          // Personal data is only offered to the browser's autofill for the primary guest.
          autoComplete: position === 0 ? (AUTOCOMPLETE[field] ?? "off") : "off",
          value: feedback?.values?.[name] ?? stored[field] ?? "",
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
