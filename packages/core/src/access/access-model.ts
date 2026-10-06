/**
 * Physical access (ADR 0017) – provider-neutral. Smart locks (Nuki, DOM, TESA, Glutz,
 * Pindora …), key boxes and manual handover are *providers*; the guest app only ever sees a
 * normalised AccessCredential and the result of getAccessForStay(). No provider model,
 * lock id or provider name reaches the guest UI.
 */
import { localDateOf } from "../journey/guest-journey";
import { type LocalizedText } from "../i18n/localized-text";

export const ACCESS_CREDENTIAL_TYPES = ["pin", "link", "keybox", "physical_key", "other"] as const;
export type AccessCredentialType = (typeof ACCESS_CREDENTIAL_TYPES)[number];

export const ACCESS_CREDENTIAL_STATUSES = ["scheduled", "active", "revoked", "expired"] as const;
export type AccessCredentialStatus = (typeof ACCESS_CREDENTIAL_STATUSES)[number];

/** Normalised credential – what every AccessProvider returns. */
export type AccessCredential = {
  type: AccessCredentialType;
  status: AccessCredentialStatus;
  /** ISO 8601 instants. */
  validFrom: string;
  validUntil: string;
  /** PIN / key box code / link – only when the provider allows showing it to the guest. */
  displayValue?: string;
  instructions?: LocalizedText;
  /** Internal provider name (server-side only; never rendered). */
  provider: string;
  /** Id at the provider (e.g. a lock authorisation id) – never a secret. */
  externalCredentialId?: string;
};

export type AccessRequest = {
  tenantId: string;
  propertyId: string;
  unitId?: string;
  reservation: { provider: string; externalReservationId: string };
  checkInAt: string;
  checkOutAt: string;
};

/**
 * Port per access system. Implementations: "manual" and "keybox" (Phase 11). A smart-lock
 * adapter later issues/looks up a credential for the reservation – same interface.
 */
export interface AccessProvider {
  readonly name: string;
  /** Undefined when nothing is issued (yet). Must not log or throw codes. */
  getCredential(request: AccessRequest): Promise<AccessCredential | undefined>;
}

export const ACCESS_MODES = ["manual", "keybox"] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

/** When access information may be shown at the earliest. */
export const ACCESS_RELEASES = ["arrival-day", "check-in-time"] as const;
export type AccessRelease = (typeof ACCESS_RELEASES)[number];

/** Per-property access settings – separate from the registration configuration. */
export type PropertyAccessConfig = {
  mode: AccessMode;
  release: AccessRelease;
  /** Configurable per property: access only after a completed online check-in. */
  requiresCompletedRegistration: boolean;
  /** Shown in manual mode and alongside a credential. */
  instructions?: LocalizedText;
};

export const DEFAULT_ACCESS_CONFIG: PropertyAccessConfig = {
  mode: "manual",
  release: "arrival-day",
  requiresCompletedRegistration: false,
};

/** A credential as the guest UI may receive it. */
export type GuestAccessCredential = {
  type: AccessCredentialType;
  validFrom: string;
  validUntil: string;
  /** Only present when explicitly requested (reveal) and allowed. */
  displayValue?: string;
  instructions?: LocalizedText;
};

export type AccessPendingReason =
  /** Online check-in must be completed first (property setting). */
  | "registration-required"
  /** Before the release time. */
  | "not-yet-released"
  /** Released, but no credential exists (yet). */
  | "not-issued";

export type StayAccess =
  | { status: "available"; credential: GuestAccessCredential }
  | { status: "pending"; reason: AccessPendingReason; releasesAt?: string }
  | { status: "manual"; instructions?: LocalizedText };

export type StayAccessInput = {
  config: PropertyAccessConfig;
  window: { checkInAt: string; checkOutAt: string; timeZone: string };
  registrationCompleted: boolean;
  now: Date;
  /** Loaded lazily – only called once all rules allow showing access. */
  loadCredential: () => Promise<AccessCredential | undefined>;
  /** Include displayValue (code) – only for an explicit reveal by the guest. */
  includeDisplayValue?: boolean;
};

/** Start of the property-local arrival date as an instant. */
function startOfLocalDay(instant: Date, timeZone: string): Date {
  const date = localDateOf(instant, timeZone);
  // Walk back from the instant in hour steps until the local date changes (DST-safe).
  let cursor = new Date(instant.getTime());
  while (localDateOf(new Date(cursor.getTime() - 60 * 60 * 1000), timeZone) === date) {
    cursor = new Date(cursor.getTime() - 60 * 60 * 1000);
  }
  // Fine-tune to the minute.
  while (localDateOf(new Date(cursor.getTime() - 60 * 1000), timeZone) === date) {
    cursor = new Date(cursor.getTime() - 60 * 1000);
  }
  return cursor;
}

export function accessReleaseAt(
  config: Pick<PropertyAccessConfig, "release">,
  window: StayAccessInput["window"],
): Date {
  const checkIn = new Date(window.checkInAt);
  return config.release === "check-in-time" ? checkIn : startOfLocalDay(checkIn, window.timeZone);
}

/**
 * The single decision whether, and what, access information a guest gets. Order:
 * stay over → nothing; registration rule → pending; release time → pending;
 * manual mode → instructions; otherwise the provider's credential.
 */
export async function getAccessForStay(input: StayAccessInput): Promise<StayAccess> {
  const { config, window, now } = input;
  const checkOut = new Date(window.checkOutAt);
  if (now.getTime() >= checkOut.getTime()) {
    return { status: "pending", reason: "not-issued" };
  }
  if (config.requiresCompletedRegistration && !input.registrationCompleted) {
    return { status: "pending", reason: "registration-required" };
  }
  const releasesAt = accessReleaseAt(config, window);
  if (now.getTime() < releasesAt.getTime()) {
    return { status: "pending", reason: "not-yet-released", releasesAt: releasesAt.toISOString() };
  }
  if (config.mode === "manual") {
    return {
      status: "manual",
      ...(config.instructions ? { instructions: config.instructions } : {}),
    };
  }
  const credential = await input.loadCredential();
  if (!credential) {
    // Key box configured but no code stored: the guest gets the manual instructions.
    return {
      status: "manual",
      ...(config.instructions ? { instructions: config.instructions } : {}),
    };
  }
  // Once released, a scheduled credential is shown in advance (with its "valid from");
  // revoked or expired ones never are.
  const usable =
    (credential.status === "active" || credential.status === "scheduled") &&
    now.getTime() < Date.parse(credential.validUntil);
  if (!usable) return { status: "pending", reason: "not-issued" };
  const instructions = credential.instructions ?? config.instructions;
  return {
    status: "available",
    credential: {
      type: credential.type,
      validFrom: credential.validFrom,
      validUntil: credential.validUntil,
      ...(input.includeDisplayValue && credential.displayValue
        ? { displayValue: credential.displayValue }
        : {}),
      ...(instructions ? { instructions } : {}),
    },
  };
}
