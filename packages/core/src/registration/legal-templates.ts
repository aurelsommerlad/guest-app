/**
 * Registration templates per country (ADR 0021). A template describes which data registration
 * law *may* require; a property only uses it once an admin applies it to its configuration.
 * C1 prepares the German template for HØV and LÆKE; Austria (HŪSLE, ΛLPILΛ) follows.
 *
 * WORKING ASSUMPTION – not legal advice. Status "draft-legal-review" until confirmed; the
 * open checks below (municipal tourist tax / guest card statutes in particular) must be
 * answered before a property goes live with it.
 */
import {
  type PropertyRegistrationConfig,
  type RegistrationField,
  type RegistrationGuestData,
} from "./registration-model";
import { ageOn, isValidIsoDate, propertyRegistrationConfigSchema } from "./registration-rules";
import { type SharedAddressPolicy } from "./shared-address";

export type FieldSet = readonly RegistrationField[];

export type LegalRegistrationTemplate = {
  id: string;
  version: string;
  country: string;
  reviewStatus: "draft-legal-review" | "confirmed";
  intendedPropertyIds: readonly string[];
  legalBasis: readonly string[];
  /** Nationalities for which no registration form is required (DE since 2025: German nationals). */
  exemptNationalities: readonly string[];
  primary: { always: FieldSet; whenNotExempt: FieldSet };
  companions: { always: FieldSet; whenNotExempt: FieldSet };
  /** Minors travelling with the main guest (no document number of their own). */
  minors: { underAge: number; always: FieldSet; whenNotExempt: FieldSet };
  sharedAddress: SharedAddressPolicy;
  retention: { keepDaysAfterArrival: number; destroyWithinDays: number };
  openChecks: readonly { id: string; question: string }[];
};

export const DE_BMG_TEMPLATE: LegalRegistrationTemplate = {
  id: "de-bmg",
  version: "2025-01",
  country: "DE",
  reviewStatus: "draft-legal-review",
  intendedPropertyIds: ["hov", "laeke"],
  legalBasis: [
    "BMG § 29 (besondere Meldepflicht in Beherbergungsstätten, seit BEG IV ab 01.01.2025 nur für ausländische Personen)",
    "BMG § 30 (Inhalt des Meldescheins, Aufbewahrung und Vernichtung)",
  ],
  exemptNationalities: ["DE"],
  primary: {
    // Name, birth date (age of the responsible person), nationality (decides the form) and
    // address are collected for everyone; whether German guests need them for the tourist tax
    // is an open check.
    always: [
      "firstName",
      "lastName",
      "birthDate",
      "nationality",
      "street",
      "postalCode",
      "city",
      "country",
    ],
    whenNotExempt: ["documentType", "documentNumber"],
  },
  companions: {
    always: ["firstName", "lastName"],
    whenNotExempt: ["birthDate", "nationality", "documentType", "documentNumber"],
  },
  minors: {
    underAge: 18,
    always: ["firstName", "lastName", "birthDate"],
    whenNotExempt: ["nationality"],
  },
  sharedAddress: "allowed",
  retention: { keepDaysAfterArrival: 365, destroyWithinDays: 90 },
  openChecks: [
    {
      id: "de-family-exemption",
      question:
        "BMG § 29 Abs. 2: Reicht für mitreisende Ehe-/Lebenspartner und minderjährige Kinder die Angabe von Anzahl und Staatsangehörigkeit auf dem Meldeschein des Hauptgasts? Dann können Dokumentdaten für diese Begleitpersonen entfallen.",
    },
    {
      id: "de-kurtaxe-hov",
      question:
        "Kurtaxe-/Gästebeitragssatzung der Gemeinde von HØV: Welche Daten (Name, Geburtsdatum aller Gäste für Altersstufen, Anschrift) werden für alle Gäste verlangt, auch für deutsche?",
    },
    {
      id: "de-kurtaxe-laeke",
      question:
        "Kurtaxe-/Gästebeitragssatzung der Gemeinde von LÆKE: wie bei HØV; zusätzlich: Gästekarte vorhanden, über welches System gemeldet (Feratel/Meldeschein-Software)?",
    },
    {
      id: "de-digital-form",
      question:
        "BMG § 29 Abs. 5: Anforderungen an den elektronischen Meldeschein (Unterschriftsersatz, Identitätsfeststellung bei Anreise) für den Online-Check-in bestätigen.",
    },
    {
      id: "de-retention",
      question:
        "Aufbewahrung ein Jahr ab Anreise, Vernichtung binnen drei Monaten – Satzungsrecht der Gemeinden kann abweichen.",
    },
  ],
};

export const LEGAL_REGISTRATION_TEMPLATES: readonly LegalRegistrationTemplate[] = [DE_BMG_TEMPLATE];

function isExempt(template: LegalRegistrationTemplate, nationality: string | undefined): boolean {
  return nationality !== undefined && template.exemptNationalities.includes(nationality);
}

function unique(fields: readonly RegistrationField[]): RegistrationField[] {
  return [...new Set(fields)];
}

/**
 * Fields the template requires for this traveller. While the nationality is unknown, the
 * stricter set applies (nothing is waived on a guess).
 */
export function legalRequiredFields(
  template: LegalRegistrationTemplate,
  guest: { position: number; data: RegistrationGuestData },
  arrivalDate: string,
): RegistrationField[] {
  const exempt = isExempt(template, guest.data.nationality);
  if (guest.position === 0) {
    return unique([...template.primary.always, ...(exempt ? [] : template.primary.whenNotExempt)]);
  }
  const birthDate = guest.data.birthDate;
  const minor =
    birthDate !== undefined &&
    isValidIsoDate(birthDate) &&
    ageOn(birthDate, arrivalDate) < template.minors.underAge;
  const rules = minor ? template.minors : template.companions;
  return unique([...rules.always, ...(exempt ? [] : rules.whenNotExempt)]);
}

/** Whether a registration form is due for this main guest under the template. */
export function registrationFormRequired(
  template: LegalRegistrationTemplate,
  primaryNationality: string | undefined,
): boolean {
  return !isExempt(template, primaryNationality);
}

/**
 * A property configuration candidate built from the template (always-fields required, the
 * conditional ones optional; legalRequiredFields decides per traveller). Not applied anywhere
 * automatically – an admin must review and save it.
 */
export function configFromTemplate(
  template: LegalRegistrationTemplate,
  base: Pick<PropertyRegistrationConfig, "targets" | "providerSettings" | "guestCardRelevant">,
): PropertyRegistrationConfig {
  const optional = (always: FieldSet, conditional: FieldSet) =>
    conditional.filter((field) => !always.includes(field));
  return propertyRegistrationConfigSchema.parse({
    enabled: false,
    country: template.country,
    targets: [...base.targets],
    primaryGuest: {
      required: [...template.primary.always],
      optional: optional(template.primary.always, template.primary.whenNotExempt),
    },
    companions: {
      required: [...template.companions.always],
      optional: optional(template.companions.always, template.companions.whenNotExempt),
    },
    children: {
      underAge: template.minors.underAge,
      required: [...template.minors.always],
      optional: optional(template.minors.always, template.minors.whenNotExempt),
    },
    guestCardRelevant: base.guestCardRelevant,
    providerSettings: base.providerSettings,
    // Legal retention counts from arrival (template.retention); it is applied by the purge
    // job in C2, not mapped onto the departure-based contact retention.
  });
}
