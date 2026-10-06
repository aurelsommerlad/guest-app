/**
 * Canonical guest registration (online check-in, ADR 0016).
 *
 * Our own, provider-neutral model: the online check-in writes only this. PMS write-back
 * (Apaleo) and official guest registration (Feratel, …) are *targets* that receive a
 * mapped copy through the sync layer – their field names never become ours.
 *
 * Data minimisation: only fields a property's configuration asks for are collected – plus
 * the contact data every stay needs (ROLE_MANDATORY_FIELDS): the main guest's e-mail and a
 * mobile number for every traveller. No free text. Identity documents only where a
 * property requires them.
 */

/** Every field a guest can be asked for. Which ones are used is property configuration. */
export const REGISTRATION_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "birthDate",
  "nationality",
  "street",
  "postalCode",
  "city",
  "country",
  "documentType",
  "documentNumber",
] as const;
export type RegistrationField = (typeof REGISTRATION_FIELDS)[number];

/** Every property configuration must require these (identify a traveller). */
export const MANDATORY_FIELDS: readonly RegistrationField[] = ["firstName", "lastName"];

/**
 * Required by UNIQUE PLACES for every stay, independent of the property configuration:
 * a real e-mail for the main guest (reachable, not a channel relay) and a mobile number
 * for every traveller. Fellow travellers are not asked for an e-mail.
 */
export const ROLE_MANDATORY_FIELDS: Readonly<
  Record<"primary" | "companion", readonly RegistrationField[]>
> = {
  primary: ["firstName", "lastName", "email", "phone"],
  companion: ["firstName", "lastName", "phone"],
};

/** Fields of the "Meldedaten" step (address and document) – the rest is personal data. */
export const ADDRESS_FIELDS: readonly RegistrationField[] = [
  "street",
  "postalCode",
  "city",
  "country",
  "documentType",
  "documentNumber",
];

export const DOCUMENT_TYPES = ["passport", "id-card", "other"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** One traveller's values as entered so far (a draft may be incomplete). */
export type RegistrationGuestData = Partial<Record<RegistrationField, string>>;

export const GUEST_ROLES = ["primary", "companion"] as const;
export type GuestRole = (typeof GUEST_ROLES)[number];

export type RegistrationGuest = {
  /** 0 = primary guest, 1… = fellow travellers in entry order. */
  position: number;
  role: GuestRole;
  data: RegistrationGuestData;
  /**
   * Fields whose value came from the PMS and was not changed by the guest (provenance:
   * PMS data vs. guest input). Missing = nothing prefilled.
   */
  prefilledFields?: readonly RegistrationField[];
};

export const REGISTRATION_STATUSES = ["draft", "submitted"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** Where the number of travellers came from. */
export const GUEST_COUNT_SOURCES = ["reservation", "guest"] as const;
export type GuestCountSource = (typeof GUEST_COUNT_SOURCES)[number];

export const MAX_TRAVELLERS = 12;

export type GuestRegistration = {
  id: string;
  tenantId: string;
  propertyId: string;
  reservationProvider: string;
  externalReservationId: string;
  status: RegistrationStatus;
  guestCount: number;
  guestCountSource: GuestCountSource;
  guests: readonly RegistrationGuest[];
  submittedAt?: Date;
  /** Set when the reservation's occupancy changed the guest count of a draft (cleared on save). */
  guestCountChangedAt?: Date;
  /** Personal data may be removed after this instant (retention, ADR 0016). */
  purgeAfter?: Date;
  /** Optimistic concurrency: incremented on every write. */
  version: number;
};

/** Targets a canonical registration is synchronised to. Extended per verified adapter. */
export const REGISTRATION_TARGETS = ["apaleo", "feratel"] as const;
export type RegistrationTarget = (typeof REGISTRATION_TARGETS)[number];

export type GuestFieldRules = {
  required: readonly RegistrationField[];
  optional: readonly RegistrationField[];
};

/**
 * Per-property registration configuration. Stored in property_journey_settings and
 * validated by propertyRegistrationConfigSchema; never hard-coded per property.
 */
export type PropertyRegistrationConfig = {
  enabled: boolean;
  /** ISO 3166-1 alpha-2 country of the property (registration law differs per country). */
  country: string;
  /** Sync targets after submission, e.g. ["apaleo"] or ["apaleo", "feratel"]. */
  targets: readonly RegistrationTarget[];
  primaryGuest: GuestFieldRules;
  companions: GuestFieldRules;
  /** Fellow travellers younger than `underAge` (at arrival) use these rules instead. */
  children?: { underAge: number } & GuestFieldRules;
  /** Whether the destination issues guest cards (informational until guest cards exist). */
  guestCardRelevant: boolean;
  /**
   * Non-secret provider settings, e.g. a Feratel destination key. Credentials never live
   * here – only in server-side environment/secret storage.
   */
  providerSettings: Partial<Record<RegistrationTarget, Readonly<Record<string, string>>>>;
  /** Days after departure until personal data is purged; undefined = not configured yet. */
  retentionDaysAfterDeparture?: number;
};

/** trip → guests (main guest + fellow travellers) → address (main guest's registration data) → review */
export const CHECK_IN_STEPS = ["trip", "guests", "address", "review"] as const;
export type CheckInStep = (typeof CHECK_IN_STEPS)[number];
