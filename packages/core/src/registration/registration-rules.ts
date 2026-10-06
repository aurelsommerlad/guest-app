import { z } from "zod";

import { isCountryCode } from "./countries";
import {
  ADDRESS_FIELDS,
  CHECK_IN_STEPS,
  type CheckInStep,
  DOCUMENT_TYPES,
  type GuestFieldRules,
  type GuestRegistration,
  type GuestRole,
  MANDATORY_FIELDS,
  type PropertyRegistrationConfig,
  REGISTRATION_FIELDS,
  REGISTRATION_TARGETS,
  type RegistrationField,
  type RegistrationGuestData,
} from "./registration-model";

/* ------------------------------------------------------------------------------------------
 * Property configuration
 * ---------------------------------------------------------------------------------------- */

const fieldList = z
  .array(z.enum(REGISTRATION_FIELDS))
  .max(REGISTRATION_FIELDS.length)
  .refine((fields) => new Set(fields).size === fields.length, "fields must be unique");

const fieldRulesSchema = z
  .strictObject({ required: fieldList, optional: fieldList })
  .refine(
    (rules) => MANDATORY_FIELDS.every((field) => rules.required.includes(field)),
    "first and last name are always required",
  )
  .refine(
    (rules) => rules.required.every((field) => !rules.optional.includes(field)),
    "a field is either required or optional",
  );

const providerSettingsSchema = z
  .record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,40}$/), z.string().trim().min(1).max(200))
  .refine((value) => Object.keys(value).length <= 10, "too many settings");

export const propertyRegistrationConfigSchema = z.strictObject({
  enabled: z.boolean(),
  country: z.string().refine(isCountryCode, "must be an ISO 3166-1 alpha-2 code"),
  targets: z
    .array(z.enum(REGISTRATION_TARGETS))
    .refine((targets) => new Set(targets).size === targets.length, "targets must be unique"),
  primaryGuest: fieldRulesSchema,
  companions: fieldRulesSchema,
  children: z
    .strictObject({
      underAge: z.number().int().min(1).max(18),
      required: fieldList,
      optional: fieldList,
    })
    .refine(
      (rules) => MANDATORY_FIELDS.every((field) => rules.required.includes(field)),
      "first and last name are always required",
    )
    .optional(),
  guestCardRelevant: z.boolean(),
  providerSettings: z.partialRecord(z.enum(REGISTRATION_TARGETS), providerSettingsSchema),
  retentionDaysAfterDeparture: z.number().int().min(1).max(3650).optional(),
});

/** Online check-in switched off – what a property without configuration gets. */
export const REGISTRATION_DISABLED: PropertyRegistrationConfig = {
  enabled: false,
  country: "DE",
  targets: [],
  primaryGuest: { required: MANDATORY_FIELDS, optional: [] },
  companions: { required: MANDATORY_FIELDS, optional: [] },
  guestCardRelevant: false,
  providerSettings: {},
};

/* ------------------------------------------------------------------------------------------
 * Field values
 * ---------------------------------------------------------------------------------------- */

/** Text without control characters or angle brackets, NFC-normalised. */
function plainText(max: number) {
  return z
    .string()
    .transform((value) => value.normalize("NFC").replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(1)
        .max(max)
        .regex(/^[^\p{Cc}<>]+$/u),
    );
}

const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: string): boolean {
  const match = isoDate.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

const country = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .refine(isCountryCode);

const fieldSchemas: Record<RegistrationField, z.ZodType<string, string>> = {
  firstName: plainText(100),
  lastName: plainText(100),
  birthDate: z
    .string()
    .trim()
    .refine(isValidIsoDate)
    .refine((value) => value >= "1900-01-01"),
  nationality: country,
  street: plainText(200),
  postalCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9 -]{1,11}$/),
  city: plainText(100),
  country,
  documentType: z.enum(DOCUMENT_TYPES),
  documentNumber: z
    .string()
    .transform((value) => value.replace(/\s+/g, "").toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9<-]{3,40}$/)),
};

export type FieldError = { field: RegistrationField; code: "required" | "invalid" };

/** Every field shown for a guest of this role (union of all rule sets that may apply). */
export function fieldsForRole(
  config: PropertyRegistrationConfig,
  role: GuestRole,
): RegistrationField[] {
  const sets: GuestFieldRules[] =
    role === "primary"
      ? [config.primaryGuest]
      : [config.companions, ...(config.children ? [config.children] : [])];
  const wanted = new Set(sets.flatMap((rules) => [...rules.required, ...rules.optional]));
  return REGISTRATION_FIELDS.filter((field) => wanted.has(field));
}

/** Full years between a birth date and a local date (both YYYY-MM-DD). */
export function ageOn(birthDate: string, onDate: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [y, m, d] = onDate.split("-").map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** The rule set that applies to one guest (children rules depend on the birth date). */
export function rulesFor(
  config: PropertyRegistrationConfig,
  role: GuestRole,
  data: RegistrationGuestData,
  arrivalDate: string,
): GuestFieldRules {
  if (role === "primary") return config.primaryGuest;
  const { children } = config;
  if (children && data.birthDate && isValidIsoDate(data.birthDate)) {
    if (ageOn(data.birthDate, arrivalDate) < children.underAge) return children;
  }
  return config.companions;
}

/**
 * Raw form values → normalised guest data. Only fields the property asks for are kept
 * (anything else is dropped, never stored); empty values are removed. Invalid values are
 * reported and not kept.
 */
export function normalizeGuestInput(
  raw: Readonly<Record<string, unknown>>,
  allowed: readonly RegistrationField[],
  today: string,
): { data: RegistrationGuestData; errors: FieldError[] } {
  const data: RegistrationGuestData = {};
  const errors: FieldError[] = [];
  for (const field of allowed) {
    const value = raw[field];
    if (typeof value !== "string" || value.trim() === "") continue;
    const parsed = fieldSchemas[field].safeParse(value.slice(0, 400));
    if (!parsed.success || (field === "birthDate" && parsed.data > today)) {
      errors.push({ field, code: "invalid" });
      continue;
    }
    data[field] = parsed.data;
  }
  return { data, errors };
}

/** Required fields that are missing or invalid for this guest. */
export function missingFields(
  rules: GuestFieldRules,
  data: RegistrationGuestData,
  fields: readonly RegistrationField[] = REGISTRATION_FIELDS,
): RegistrationField[] {
  return rules.required.filter(
    (field) =>
      fields.includes(field) &&
      (data[field] === undefined || !fieldSchemas[field].safeParse(data[field]).success),
  );
}

/* ------------------------------------------------------------------------------------------
 * Progress
 * ---------------------------------------------------------------------------------------- */

export type StepState = "complete" | "incomplete" | "skipped";

export type RegistrationAssessment = {
  steps: Record<CheckInStep, StepState>;
  /** Steps still to do (review counts until submitted). */
  stepsRemaining: number;
  /** All data steps complete – the registration may be submitted. */
  readyToSubmit: boolean;
  /** First step that is not complete (where "continue" leads). */
  nextStep: CheckInStep;
};

const PERSONAL_FIELDS = REGISTRATION_FIELDS.filter((field) => !ADDRESS_FIELDS.includes(field));

export function hasAddressStep(config: PropertyRegistrationConfig): boolean {
  return fieldsForRole(config, "primary").some((field) => ADDRESS_FIELDS.includes(field));
}

export function assessRegistration(
  config: PropertyRegistrationConfig,
  registration: Pick<GuestRegistration, "status" | "guestCount" | "guests"> | undefined,
  arrivalDate: string,
): RegistrationAssessment {
  const guests = registration?.guests ?? [];
  const primary = guests.find((guest) => guest.position === 0)?.data ?? {};
  const companionsComplete = () => {
    for (let position = 1; position < (registration?.guestCount ?? 1); position++) {
      const data = guests.find((guest) => guest.position === position)?.data ?? {};
      if (missingFields(rulesFor(config, "companion", data, arrivalDate), data).length > 0) {
        return false;
      }
    }
    return true;
  };
  const state = (done: boolean): StepState => (done ? "complete" : "incomplete");
  const steps: Record<CheckInStep, StepState> = {
    trip: state(registration !== undefined),
    primary: state(
      registration !== undefined &&
        missingFields(config.primaryGuest, primary, PERSONAL_FIELDS).length === 0,
    ),
    companions:
      registration !== undefined && registration.guestCount <= 1
        ? "skipped"
        : state(registration !== undefined && companionsComplete()),
    address: !hasAddressStep(config)
      ? "skipped"
      : state(
          registration !== undefined &&
            missingFields(config.primaryGuest, primary, ADDRESS_FIELDS).length === 0,
        ),
    review: state(registration?.status === "submitted"),
  };
  const open = CHECK_IN_STEPS.filter((step) => steps[step] === "incomplete");
  return {
    steps,
    stepsRemaining: open.length,
    readyToSubmit: CHECK_IN_STEPS.every(
      (step) => step === "review" || steps[step] !== "incomplete",
    ),
    nextStep: open[0] ?? "review",
  };
}
