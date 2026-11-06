/**
 * Registration settings per tenant, property and target (ADR 0022, F2) – stored in
 * official_registration_settings. Nothing is hard-coded per destination:
 *
 * - when the binding registration form is created (arrival day or N days before),
 * - from when a pre-registration may be created,
 * - which operations are confirmed for this destination (`allowedOperations`). Effective is
 *   the intersection with what the adapter's documentation supports – so changes after a
 *   binding registration depend on confirmed Feratel functions, not on code.
 *
 * Until approved, an enabled property can only use the simulated environment (schema here
 * and CHECK constraint in the database).
 */
import { z } from "zod";

import { isValidIsoDate } from "../registration/dates";
import {
  OFFICIAL_OPERATIONS,
  OFFICIAL_REGISTRATION_TARGETS,
  type OfficialOperation,
  type ProviderCapabilities,
  type StayDates,
} from "./model";

export const OFFICIAL_ENVIRONMENTS = ["simulated", "test", "production"] as const;
export type OfficialEnvironment = (typeof OFFICIAL_ENVIRONMENTS)[number];

export const BINDING_REGISTRATION_RULES = ["arrival-day", "days-before-arrival"] as const;
export type BindingRegistrationRule = (typeof BINDING_REGISTRATION_RULES)[number];

const nonSecretSettings = z
  .record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,40}$/), z.string().trim().min(1).max(200))
  .refine((value) => Object.keys(value).length <= 10, "too many settings");

export const officialRegistrationSettingsSchema = z
  .strictObject({
    target: z.enum(OFFICIAL_REGISTRATION_TARGETS),
    enabled: z.boolean(),
    environment: z.enum(OFFICIAL_ENVIRONMENTS),
    bindingRegistration: z.discriminatedUnion("rule", [
      z.strictObject({ rule: z.literal("arrival-day") }),
      z.strictObject({
        rule: z.literal("days-before-arrival"),
        days: z.number().int().min(1).max(30),
      }),
    ]),
    /** Pre-registration at most this many days before arrival; undefined = right after check-in. */
    preRegistrationLeadDays: z.number().int().min(1).max(365).optional(),
    /** Operations confirmed for this destination (subset of the adapter's capabilities). */
    allowedOperations: z
      .array(z.enum(OFFICIAL_OPERATIONS))
      .max(OFFICIAL_OPERATIONS.length)
      .refine((ops) => new Set(ops).size === ops.length, "operations must be unique"),
    guestCards: z.boolean(),
    childUnderAge: z.number().int().min(1).max(18),
    /** Non-secret values, e.g. the mapping code. Credentials never live here. */
    providerSettings: nonSecretSettings,
    /** Days after departure until the state row is purged; undefined = not configured yet. */
    stateRetentionDaysAfterDeparture: z.number().int().min(1).max(3650).optional(),
    /** Days until protocol entries may be purged; undefined = not configured yet. */
    eventRetentionDays: z.number().int().min(1).max(3650).optional(),
  })
  .refine((settings) => !settings.enabled || settings.environment === "simulated", {
    message: "only the simulated environment may be enabled before approval",
    path: ["environment"],
  });
export type OfficialRegistrationSettings = z.infer<typeof officialRegistrationSettingsSchema>;

function shiftDate(date: string, days: number): string {
  if (!isValidIsoDate(date)) throw new RangeError("Invalid date");
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

/** Local date on which the binding registration is due. */
export function bindingRegistrationDate(
  stay: StayDates,
  rule: OfficialRegistrationSettings["bindingRegistration"],
): string {
  return rule.rule === "arrival-day" ? stay.arrivalDate : shiftDate(stay.arrivalDate, -rule.days);
}

/** First local date on which a pre-registration may be created (undefined = any time). */
export function preRegistrationOpensOn(
  stay: StayDates,
  leadDays: number | undefined,
): string | undefined {
  return leadDays === undefined ? undefined : shiftDate(stay.arrivalDate, -leadDays);
}

/** What may actually be done: documented by the adapter AND confirmed for the destination. */
export function effectiveCapabilities(
  documented: ProviderCapabilities,
  allowed: readonly OfficialOperation[],
): ProviderCapabilities {
  const result = { ...documented } as Record<string, boolean>;
  for (const operation of OFFICIAL_OPERATIONS) {
    result[operation] = documented[operation] && allowed.includes(operation);
  }
  return result as unknown as ProviderCapabilities;
}
