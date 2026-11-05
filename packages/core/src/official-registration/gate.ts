/**
 * When may a registration be handed to the target at all (ADR 0022)?
 *
 * Three switches must agree – the global mode, the property's enablement and the
 * property's environment – and the check-in must be complete including the required
 * confirmations (ADR 0021). In F1 the only transmitting mode is "simulated": test and
 * production cannot even be configured yet.
 */
import { z } from "zod";

import { type CompletenessBlocker } from "../check-in-status/check-in-status";

/** Global switch (env OFFICIAL_REGISTRATION_MODE). F4 adds "test", production needs approval. */
export const officialRegistrationModeSchema = z.enum(["disabled", "simulated"]);
export type OfficialRegistrationMode = z.infer<typeof officialRegistrationModeSchema>;

/** Per property (providerSettings / journey settings in F2). */
export const officialRegistrationPropertySchema = z.strictObject({
  enabled: z.boolean(),
  environment: z.literal("simulated"),
  /** Guest cards are issued by the destination for this property. */
  guestCards: z.boolean(),
  /** Travellers younger than this count as children (tax / card category). */
  childUnderAge: z.number().int().min(1).max(18),
});
export type OfficialRegistrationPropertySettings = z.infer<
  typeof officialRegistrationPropertySchema
>;

export const OFFICIAL_GATE_REASONS = [
  "mode-disabled",
  "property-not-enabled",
  "environment-mismatch",
  "live-property",
  "not-submitted",
  "check-in-incomplete",
] as const;
export type OfficialGateReason = (typeof OFFICIAL_GATE_REASONS)[number];

export type OfficialGateInput = {
  mode: OfficialRegistrationMode;
  property: OfficialRegistrationPropertySettings | undefined;
  /** Only test properties may use the simulated target. */
  propertyIsTestOnly: boolean;
  registrationSubmitted: boolean;
  /** From deriveCheckInStatus (data, responsible adult, e-mail confirmation). */
  completenessBlockers: readonly CompletenessBlocker[];
};

export type OfficialGateResult = { open: true } | { open: false; reasons: OfficialGateReason[] };

/** Written for the wider enums of F4 (test/production); today both sides are "simulated". */
function environmentMatches(mode: string, environment: string): boolean {
  return mode === "disabled" || mode === environment;
}

export function evaluateOfficialGate(input: OfficialGateInput): OfficialGateResult {
  const reasons: OfficialGateReason[] = [];
  if (input.mode === "disabled") reasons.push("mode-disabled");
  if (!input.property?.enabled) reasons.push("property-not-enabled");
  else if (!environmentMatches(input.mode, input.property.environment)) {
    reasons.push("environment-mismatch");
  }
  if (!input.propertyIsTestOnly) reasons.push("live-property");
  if (!input.registrationSubmitted) reasons.push("not-submitted");
  if (input.completenessBlockers.length > 0) reasons.push("check-in-incomplete");
  return reasons.length === 0 ? { open: true } : { open: false, reasons };
}
