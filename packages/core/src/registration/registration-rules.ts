import { z } from "zod";

import { normalizeEmail, usableContactEmail } from "../contact/email";
import { normalizePhone } from "../contact/phone";
import { isCountryCode } from "./countries";
import { checkPostalCode } from "../address/postal-codes";
import { checkInValidationPolicySchema } from "../check-in-status/validation-policy";
import { ageOn, isValidIsoDate } from "./dates";
import {
  LEGAL_TEMPLATE_IDS,
  legalRequiredFields,
  legalTemplate,
  templateFields,
} from "./legal-templates";
import { responsibleAdultStatus } from "./responsible-adult";

export { ageOn, isValidIsoDate } from "./dates";
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
  ROLE_MANDATORY_FIELDS,
  type RegistrationField,
  type RegistrationGuest,
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
  contactRetentionDaysAfterDeparture: z.number().int().min(1).max(3650).optional(),
  legalTemplate: z.enum(LEGAL_TEMPLATE_IDS).optional(),
  validation: checkInValidationPolicySchema.optional(),
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

const country = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .refine(isCountryCode);

const fieldSchemas: Record<RegistrationField, z.ZodType<string, string>> = {
  firstName: plainText(100),
  lastName: plainText(100),
  // Stored values are already normalised; relay addresses never pass.
  email: z.string().refine((value) => usableContactEmail(value) === value),
  phone: z.string().refine((value) => {
    const check = normalizePhone(value);
    return check.ok && check.e164 === value;
  }),
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

export type FieldError = {
  field: RegistrationField;
  /**
   * relay-email: a channel relay such as …@guest.booking.com; not-mobile: e.g. a landline;
   * invalid-postal-code: does not fit the country's format; responsible-under-age: the main
   * guest is younger than the property's minimum age on the arrival day (ADR 0021).
   */
  code:
    | "required"
    | "invalid"
    | "relay-email"
    | "not-mobile"
    | "invalid-postal-code"
    | "responsible-under-age";
};

function unique(fields: readonly RegistrationField[]): RegistrationField[] {
  return REGISTRATION_FIELDS.filter((field) => fields.includes(field));
}

/** Every field shown for a guest of this role (union of all rule sets that may apply). */
export function fieldsForRole(
  config: PropertyRegistrationConfig,
  role: GuestRole,
): RegistrationField[] {
  const sets: GuestFieldRules[] =
    role === "primary"
      ? [config.primaryGuest]
      : [config.companions, ...(config.children ? [config.children] : [])];
  return unique([
    ...ROLE_MANDATORY_FIELDS[role],
    ...sets.flatMap((rules) => [...rules.required, ...rules.optional]),
    ...(config.legalTemplate ? templateFields(legalTemplate(config.legalTemplate), role) : []),
    ...(role === "primary" && config.validation ? (["birthDate"] as const) : []),
  ]);
}

/** The rule set that applies to one guest (children rules depend on the birth date). */
export function rulesFor(
  config: PropertyRegistrationConfig,
  role: GuestRole,
  data: RegistrationGuestData,
  arrivalDate: string,
): GuestFieldRules {
  const rules = withMandatory(baseRulesFor(config, role, data, arrivalDate), role);
  const extra: RegistrationField[] = [];
  if (config.legalTemplate) {
    extra.push(
      ...legalRequiredFields(
        legalTemplate(config.legalTemplate),
        { position: role === "primary" ? 0 : 1, data },
        arrivalDate,
      ),
    );
  }
  // The responsible person's age is checked on the server – the birth date is needed for it.
  if (role === "primary" && config.validation) extra.push("birthDate");
  let required = unique([...rules.required, ...extra]);
  // Countries without postal codes (e.g. HK, AE): the postal code is not required there.
  if (data.country && checkPostalCode(data.country, undefined) === "ok") {
    required = required.filter((field) => field !== "postalCode");
  }
  return {
    required,
    optional: unique([...rules.optional, ...rules.required, ...extra]).filter(
      (field) => !required.includes(field),
    ),
  };
}

/** Contact data UNIQUE PLACES needs for every stay is always required (ROLE_MANDATORY_FIELDS). */
function withMandatory(rules: GuestFieldRules, role: GuestRole): GuestFieldRules {
  const mandatory = ROLE_MANDATORY_FIELDS[role];
  return {
    required: unique([...mandatory, ...rules.required]),
    optional: rules.optional.filter((field) => !mandatory.includes(field)),
  };
}

function baseRulesFor(
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
 * reported and not kept. The phone number is read together with `phoneCountry` (calling
 * code selection) and stored as E.164.
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
    if (field === "email") {
      const email = normalizeEmail(value.slice(0, 400));
      if (!email) errors.push({ field, code: "invalid" });
      else if (!usableContactEmail(email)) errors.push({ field, code: "relay-email" });
      else data.email = email;
      continue;
    }
    if (field === "phone") {
      const countryHint = raw["phoneCountry"];
      const check = normalizePhone(
        value.slice(0, 40),
        typeof countryHint === "string" ? countryHint.trim().toUpperCase() : undefined,
      );
      if (check.ok) data.phone = check.e164;
      else errors.push({ field, code: check.reason === "not-mobile" ? "not-mobile" : "invalid" });
      continue;
    }
    const parsed = fieldSchemas[field].safeParse(value.slice(0, 400));
    if (!parsed.success || (field === "birthDate" && parsed.data > today)) {
      errors.push({ field, code: "invalid" });
      continue;
    }
    data[field] = parsed.data;
  }
  // The postal code must fit the country (shape only – ADR 0021).
  if (data.postalCode !== undefined && data.country !== undefined) {
    const postal = checkPostalCode(data.country, data.postalCode);
    if (postal === "invalid-format") {
      errors.push({ field: "postalCode", code: "invalid-postal-code" });
      delete data.postalCode;
    }
  }
  return { data, errors };
}

/**
 * The main guest's age on the arrival day against the property's minimum age (server-side,
 * a declaration – never "verified"). Undefined when the property sets no minimum age.
 */
export function responsibleAdultError(
  config: PropertyRegistrationConfig,
  data: RegistrationGuestData,
  arrivalDate: string,
): FieldError | undefined {
  if (!config.validation) return undefined;
  const status = responsibleAdultStatus(
    data.birthDate,
    arrivalDate,
    config.validation.responsibleAdultMinAge,
  );
  if (status === "declared-under-age") return { field: "birthDate", code: "responsible-under-age" };
  if (status === "invalid") return { field: "birthDate", code: "invalid" };
  return undefined;
}

/** Address fields a fellow traveller takes over from the main guest ("Adresse wie Hauptgast"). */
export const SHARED_ADDRESS_FIELDS: readonly RegistrationField[] = [
  "street",
  "postalCode",
  "city",
  "country",
];

/** Whether fellow travellers may use the main guest's address. */
export function sharedAddressAllowed(config: PropertyRegistrationConfig): boolean {
  return config.validation?.sharedAddress === "allowed";
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

export const PERSONAL_FIELDS = REGISTRATION_FIELDS.filter(
  (field) => !ADDRESS_FIELDS.includes(field),
);

/**
 * Fields of the "guests" step: the main guest's personal data (their address and ID come in
 * the address step); fellow travellers enter everything configured for them here.
 */
export function guestStepFields(
  config: PropertyRegistrationConfig,
  position: number,
): RegistrationField[] {
  const fields = fieldsForRole(config, position === 0 ? "primary" : "companion");
  return position === 0 ? fields.filter((field) => PERSONAL_FIELDS.includes(field)) : fields;
}

/** Required fields of the guests step this person still lacks. */
export function guestMissingFields(
  config: PropertyRegistrationConfig,
  position: number,
  data: RegistrationGuestData,
  arrivalDate: string,
  addressSource: RegistrationGuest["addressSource"] = "own",
): RegistrationField[] {
  const role = position === 0 ? "primary" : "companion";
  const sharesAddress =
    position > 0 && addressSource === "same-as-primary" && sharedAddressAllowed(config);
  return missingFields(
    rulesFor(config, role, data, arrivalDate),
    data,
    guestStepFields(config, position).filter(
      (field) => !sharesAddress || !SHARED_ADDRESS_FIELDS.includes(field),
    ),
  );
}

/** Whether the company billing step is part of this property's check-in. */
export function hasBillingStep(config: PropertyRegistrationConfig): boolean {
  return config.validation?.companyBilling === true;
}

export function hasAddressStep(config: PropertyRegistrationConfig): boolean {
  return fieldsForRole(config, "primary").some((field) => ADDRESS_FIELDS.includes(field));
}

export function assessRegistration(
  config: PropertyRegistrationConfig,
  registration: Pick<GuestRegistration, "status" | "guestCount" | "guests" | "billing"> | undefined,
  arrivalDate: string,
): RegistrationAssessment {
  const guests = registration?.guests ?? [];
  const guestAt = (position: number) => guests.find((guest) => guest.position === position);
  const dataAt = (position: number) => guestAt(position)?.data ?? {};
  const primary = dataAt(0);
  const guestsComplete = () => {
    // The responsible person must be of age on the arrival day (declaration, server-side).
    if (responsibleAdultError(config, primary, arrivalDate)) return false;
    for (let position = 0; position < (registration?.guestCount ?? 1); position++) {
      const missing = guestMissingFields(
        config,
        position,
        dataAt(position),
        arrivalDate,
        guestAt(position)?.addressSource,
      );
      if (missing.length > 0) return false;
    }
    return true;
  };
  const state = (done: boolean): StepState => (done ? "complete" : "incomplete");
  const steps: Record<CheckInStep, StepState> = {
    trip: state(registration !== undefined),
    guests: state(registration !== undefined && guestsComplete()),
    address: !hasAddressStep(config)
      ? "skipped"
      : state(
          registration !== undefined &&
            missingFields(
              rulesFor(config, "primary", primary, arrivalDate),
              primary,
              ADDRESS_FIELDS,
            ).length === 0,
        ),
    billing: !hasBillingStep(config) ? "skipped" : state(registration?.billing !== undefined),
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
