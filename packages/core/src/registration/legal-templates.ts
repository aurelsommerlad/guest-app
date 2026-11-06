/**
 * Registration templates per country (ADR 0021). A template describes which data registration
 * law *may* require; a property only uses it once an admin applies it to its configuration.
 * German template (HØV, LÆKE) and Austrian template (HŪSLE, ΛLPILΛ). A property refers to one
 * via `legalTemplate` in its registration configuration; the rules then add the template's
 * fields per traveller (nationality and age decide).
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
import { ageOn, isValidIsoDate } from "./dates";
import { type SharedAddressPolicy } from "./shared-address";

export type FieldSet = readonly RegistrationField[];

export const LEGAL_TEMPLATE_IDS = ["de-bmg", "at-meldeg"] as const;
export type LegalTemplateId = (typeof LEGAL_TEMPLATE_IDS)[number];

export type LegalRegistrationTemplate = {
  id: LegalTemplateId;
  version: string;
  country: string;
  reviewStatus: "draft-legal-review" | "confirmed";
  intendedPropertyIds: readonly string[];
  legalBasis: readonly string[];
  /**
   * Nationalities for which the `whenNotExempt` fields are not needed (DE: German nationals
   * need no form at all; AT: Austrians need no travel document).
   */
  exemptNationalities: readonly string[];
  /** Whether exempt guests still need a registration form (AT: yes, DE: no). */
  formRequiredForExempt: boolean;
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
  formRequiredForExempt: false,
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

export const AT_MELDEG_TEMPLATE: LegalRegistrationTemplate = {
  id: "at-meldeg",
  version: "2026-11",
  country: "AT",
  reviewStatus: "draft-legal-review",
  intendedPropertyIds: ["huesle", "alpila"],
  legalBasis: [
    "MeldeG § 5 (Meldepflicht in Beherbergungsbetrieben, Gästeblatt) und § 10 (Gästeverzeichnis)",
    "Vorarlberger Tourismusgesetz / Gästetaxe der Gemeinde (Bludenz, Gaschurn)",
  ],
  // Every guest is registered; Austrians need no travel document.
  exemptNationalities: ["AT"],
  formRequiredForExempt: true,
  primary: {
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
    // Gästeblatt per guest incl. residence; the guest card needs name and birth date.
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
  minors: {
    underAge: 18,
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
    whenNotExempt: [],
  },
  sharedAddress: "allowed",
  // Gästeverzeichnis: retention per Landesrecht – open check; placeholder, not applied.
  retention: { keepDaysAfterArrival: 7 * 365, destroyWithinDays: 90 },
  openChecks: [
    {
      id: "at-gender",
      question:
        "Gästeblatt (MeldeG Anlage): Ist das Geschlecht Pflicht, und mit welchen Werten (feratel `geschlecht` 0/1/2)? Bis zur Klärung wird es nicht erhoben.",
    },
    {
      id: "at-document-details",
      question:
        "Reisedokument bei Fremden: Werden Ausstellungsdatum und ausstellende Behörde verlangt? Heute erfassen wir nur Art und Nummer.",
    },
    {
      id: "at-signature",
      question:
        "Unterschrift auf dem Gästeblatt: Ersetzt der Online-Check-in die Unterschrift (feratel `signatur`), oder ist am Anreisetag eine Unterschrift bzw. ein Ausweis-Scan vor Ort nötig?",
    },
    {
      id: "at-collective-sheet",
      question:
        "Sammelblatt für Familien und Reisegruppen: Genügt für Mitreisende ein Teil der Angaben (z. B. ohne Wohnadresse)?",
    },
    {
      id: "at-retention",
      question:
        "Aufbewahrungsfrist des Gästeverzeichnisses (häufig genannt: 7 Jahre) nach Landesrecht Vorarlberg bestätigen.",
    },
    {
      id: "at-guest-tax",
      question:
        "Gästetaxe Bludenz und Gaschurn: Personengruppen, Altersgrenzen, Befreiungen (feratel `gastartlist`).",
    },
    {
      id: "at-guest-card-consent",
      question:
        "Einwilligung zur Gästekarte (feratel `zustimmungkartenprod`) je Gast: Formulierung, Einwilligung für Minderjährige durch den Hauptgast.",
    },
  ],
};

export const LEGAL_REGISTRATION_TEMPLATES: readonly LegalRegistrationTemplate[] = [
  DE_BMG_TEMPLATE,
  AT_MELDEG_TEMPLATE,
];

export function legalTemplate(id: LegalTemplateId): LegalRegistrationTemplate {
  return id === "at-meldeg" ? AT_MELDEG_TEMPLATE : DE_BMG_TEMPLATE;
}

/** Every field the template may ask of a role (always + conditional, minors included). */
export function templateFields(
  template: LegalRegistrationTemplate,
  role: "primary" | "companion",
): RegistrationField[] {
  const sets =
    role === "primary"
      ? [template.primary.always, template.primary.whenNotExempt]
      : [
          template.companions.always,
          template.companions.whenNotExempt,
          template.minors.always,
          template.minors.whenNotExempt,
        ];
  return unique(sets.flat());
}

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
  return template.formRequiredForExempt || !isExempt(template, primaryNationality);
}

/**
 * A property configuration candidate built from the template (always-fields required, the
 * conditional ones optional; legalRequiredFields decides per traveller). Not applied anywhere
 * automatically – an admin must review and save it (the schema validates it then).
 */
export function configFromTemplate(
  template: LegalRegistrationTemplate,
  base: Pick<PropertyRegistrationConfig, "targets" | "providerSettings" | "guestCardRelevant">,
): PropertyRegistrationConfig {
  const optional = (always: FieldSet, conditional: FieldSet) =>
    conditional.filter((field) => !always.includes(field));
  return {
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
    legalTemplate: template.id,
    // Legal retention counts from arrival (template.retention); it is applied by the purge
    // job, not mapped onto the departure-based contact retention.
  };
}
