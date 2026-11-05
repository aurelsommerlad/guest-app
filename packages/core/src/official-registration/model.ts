/**
 * Official guest registration (Meldewesen) – provider-neutral state model (ADR 0022).
 *
 * Two independent tracks per reservation and target:
 * - the registration itself (stage at the target + transmission status for staff),
 * - the guest card (issued and delivered by the registration system, e.g. Feratel).
 * A card problem never changes the registration status and vice versa.
 *
 * Phase F1: logic only, simulated provider answers. Nothing is persisted yet (F2) and no
 * live property is enabled.
 */
import { SYNC_ERROR_CODES } from "../registration/registration-sync";

export const OFFICIAL_REGISTRATION_TARGETS = ["feratel"] as const;
export type OfficialRegistrationTarget = (typeof OFFICIAL_REGISTRATION_TARGETS)[number];

/** Where the registration stands at the target. */
export const REMOTE_STAGES = [
  "none", // nothing at the target
  "pre-registered", // Voranmeldung: not yet official, still changeable
  "registered", // Meldeschein: official, binding
  "checked-out", // Abmeldung with the actual departure date
  "cancelled", // pre-registration deleted / registration cancelled
] as const;
export type RemoteStage = (typeof REMOTE_STAGES)[number];

/** What staff sees per reservation (Admin). */
export const TRANSMISSION_STATUSES = [
  "pending", // ausstehend: waiting for the gate, the right day or the next attempt
  "transmitted", // übertragen: accepted, no reference/confirmation yet
  "confirmed", // bestätigt: accepted with a target reference
  "failed", // Fehler: permanent error or attempts exhausted
  "manual", // manuelle Bearbeitung: a person has to act (immutable form, unclear outcome …)
] as const;
export type TransmissionStatus = (typeof TRANSMISSION_STATUSES)[number];

export const GUEST_CARD_STATUSES = [
  "not-applicable", // the destination issues no card / the property has none
  "waiting", // no registration at the target yet
  "requested", // registration with guest e-mail exists, the target issues and sends the card
  "issued",
  "delivered",
  "failed",
  "manual",
] as const;
export type GuestCardStatus = (typeof GUEST_CARD_STATUSES)[number];

export const OFFICIAL_OPERATIONS = [
  "create-pre-registration",
  "update-pre-registration",
  "delete-pre-registration",
  "create-registration",
  "convert-to-registration",
  "update-departure",
  "check-out",
  "cancel-registration",
  "lookup-by-reference",
] as const;
export type OfficialOperation = (typeof OFFICIAL_OPERATIONS)[number];

/** Operations that create something at the target – never repeated blindly. */
export const CREATING_OPERATIONS: ReadonlySet<OfficialOperation> = new Set([
  "create-pre-registration",
  "create-registration",
  "convert-to-registration",
]);

/**
 * What the target interface can do. Only operations confirmed by official documentation are
 * true; everything else is handed to staff. Feratel: all false until the documentation of
 * the Visitor Registration Interface is available (F4).
 */
export type ProviderCapabilities = Readonly<Record<OfficialOperation, boolean>> & {
  /** Write operations accept an idempotency key / are safe to repeat. */
  readonly idempotentWrites: boolean;
  /** The target reports the guest card status. */
  readonly guestCardStatus: boolean;
};

export const NO_CAPABILITIES: ProviderCapabilities = {
  ...(Object.fromEntries(OFFICIAL_OPERATIONS.map((op) => [op, false])) as Record<
    OfficialOperation,
    boolean
  >),
  idempotentWrites: false,
  guestCardStatus: false,
};

export const OFFICIAL_ERROR_CODES = [
  ...SYNC_ERROR_CODES,
  "ambiguous_outcome",
  "not_supported",
] as const;
export type OfficialErrorCode = (typeof OFFICIAL_ERROR_CODES)[number];

export const MANUAL_REASONS = [
  "not-supported", // the interface cannot do the required operation
  "ambiguous-outcome", // a creating call may or may not have reached the target
  "registration-immutable", // a binding registration would have to change
  "cancelled-after-registration",
  "attempts-exhausted",
  "rejected", // the target refused the data
  "changed-after-check-out",
] as const;
export type ManualReason = (typeof MANUAL_REASONS)[number];

/** Local stay dates as transmitted (YYYY-MM-DD in the property's time zone). */
export type StayDates = { arrivalDate: string; departureDate: string };

/** Persisted per registration and target (table in F2). No personal data. */
export type OfficialRegistrationState = {
  registrationId: string;
  tenantId: string;
  propertyId: string;
  target: OfficialRegistrationTarget;
  stage: RemoteStage;
  transmission: TransmissionStatus;
  externalReference?: string;
  /** Fingerprint of the payload the target last accepted. */
  acceptedFingerprint?: string;
  /** Same without stay dates – tells "only the dates changed" apart. */
  acceptedGuestFingerprint?: string;
  /** Stay dates the target last accepted. */
  acceptedStay?: StayDates;
  attempts: number;
  nextAttemptAt?: Date;
  lastErrorCode?: OfficialErrorCode;
  manualReason?: ManualReason;
  /** A creating call whose outcome is unknown – must be reconciled before anything else. */
  unresolved?: {
    operation: OfficialOperation;
    idempotencyKey: string;
    fingerprint: string;
    guestFingerprint: string;
    stay: StayDates;
    at: Date;
  };
  guestCard: { status: GuestCardStatus; updatedAt?: Date };
  version: number;
};

export function initialOfficialRegistrationState(input: {
  registrationId: string;
  tenantId: string;
  propertyId: string;
  target: OfficialRegistrationTarget;
  guestCardRelevant: boolean;
}): OfficialRegistrationState {
  return {
    registrationId: input.registrationId,
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    target: input.target,
    stage: "none",
    transmission: "pending",
    attempts: 0,
    guestCard: { status: input.guestCardRelevant ? "waiting" : "not-applicable" },
    version: 1,
  };
}

/** One protocol line per attempt or staff action – ids, codes and times only. */
export type OperationLogEntry = {
  registrationId: string;
  target: OfficialRegistrationTarget;
  at: Date;
  operation:
    OfficialOperation | "handover-to-staff" | "admin-retry" | "admin-resolve" | "guest-card-update";
  result: "ok" | "rejected" | "temporary" | "ambiguous" | "not-supported" | "manual" | "skipped";
  code?: OfficialErrorCode;
  attempt?: number;
  idempotencyKey?: string;
  manualReason?: ManualReason;
  actor: { kind: "system" } | { kind: "admin"; adminUserId: string };
  stageAfter: RemoteStage;
  transmissionAfter: TransmissionStatus;
};
