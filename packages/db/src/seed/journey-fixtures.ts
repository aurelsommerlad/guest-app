/**
 * Guest journey fixtures – ONLY for local development and automated tests
 * (`pnpm db:seed --target local --with-journey-fixtures`; the CLI rejects other targets).
 *
 * The registration fields below are a *sample* to exercise the flow. They are not a legal
 * statement of what a German or Austrian registration requires – real property settings
 * are confirmed by operations and entered per property (ADR 0016).
 */
import {
  encryptAccessCode,
  parseAccessCodeKey,
  type PropertyAccessConfig,
  type PropertyRegistrationConfig,
  type TenantContext,
} from "@up/core";

import { type Database } from "../client";
import { saveJourneySettings, setUnitAccessCode } from "../repositories/journey-repository";

export const sampleRegistrationConfig: PropertyRegistrationConfig = {
  enabled: true,
  country: "DE",
  targets: ["apaleo"],
  primaryGuest: {
    required: [
      "firstName",
      "lastName",
      "birthDate",
      "nationality",
      "street",
      "postalCode",
      "city",
      "country",
    ],
    optional: [],
  },
  companions: { required: ["firstName", "lastName", "birthDate", "nationality"], optional: [] },
  children: { underAge: 16, required: ["firstName", "lastName", "birthDate"], optional: [] },
  guestCardRelevant: false,
  providerSettings: {},
};

export const sampleAccessConfig: PropertyAccessConfig = {
  mode: "keybox",
  release: "arrival-day",
  requiresCompletedRegistration: false,
  instructions: {
    de: "Beispiel: Die Schlüsselbox hängt links neben der Haustür.",
    en: "Sample: the key box is to the left of the front door.",
  },
};

/** Sample key box code for the local preview unit (only with a local ACCESS_CODE_KEY). */
export const SAMPLE_KEYBOX_CODE = "2580";

export async function seedJourneyFixtures(
  db: Database,
  context: TenantContext,
  options: { accessCodeKey?: string } = {},
): Promise<{ properties: number; codes: number }> {
  await saveJourneySettings(db, context, "hov", {
    registration: sampleRegistrationConfig,
    access: sampleAccessConfig,
  });
  if (!options.accessCodeKey) return { properties: 1, codes: 0 };
  const key = parseAccessCodeKey(options.accessCodeKey);
  const binding = { tenantId: context.tenantId, propertyId: "hov", unitId: "ros" };
  await setUnitAccessCode(
    db,
    context,
    { propertyId: "hov", unitId: "ros" },
    encryptAccessCode(key, binding, SAMPLE_KEYBOX_CODE),
  );
  return { properties: 1, codes: 1 };
}
