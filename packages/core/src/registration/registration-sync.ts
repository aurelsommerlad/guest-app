/**
 * Registration sync layer (ADR 0016): canonical registration → targets (Apaleo
 * write-back, Feratel guest registration, …). One persistent sync row per registration and
 * target; the guest never waits for, or sees, a provider.
 */
import { type RegistrationGuestData, type RegistrationTarget } from "./registration-model";

export const SYNC_STATUSES = [
  "pending",
  "processing",
  "synced",
  "failed",
  "retry_required",
] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

/** Safe, stable error codes – never provider messages or response bodies. */
export const SYNC_ERROR_CODES = [
  "timeout",
  "unavailable",
  "rate_limited",
  "auth",
  "not_found",
  "rejected",
  "conflict",
  "invalid_data",
  "not_configured",
  "unknown",
] as const;
export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number];

/** What a target receives: our canonical data, already filtered to the submitted fields. */
export type RegistrationSubmission = {
  registrationId: string;
  tenantId: string;
  propertyId: string;
  reservation: { provider: string; externalReservationId: string };
  /** ISO 8601 instants with offset. */
  arrivalAt: string;
  departureAt: string;
  guests: readonly {
    position: number;
    role: "primary" | "companion";
    data: RegistrationGuestData;
  }[];
  /** Non-secret settings of this target from the property configuration. */
  settings: Readonly<Record<string, string>>;
};

export type SyncOutcome =
  | { status: "synced"; externalReference?: string; fingerprint?: string }
  /** Temporary – try again later (network, 5xx, rate limit, timeout). */
  | { status: "retry"; code: SyncErrorCode }
  /** Permanent – needs a human (rejected data, missing permission). Data is kept. */
  | { status: "failed"; code: SyncErrorCode };

/** Port implemented per target in @up/integrations. Must not throw for expected failures. */
export interface GuestRegistrationProvider {
  readonly target: RegistrationTarget;
  submit(submission: RegistrationSubmission, previous: SyncMemory): Promise<SyncOutcome>;
}

/** What the sync row remembers from the last successful write (no personal data). */
export type SyncMemory = { externalReference?: string; fingerprint?: string };

/** After this many attempts a sync is marked failed and waits for a human. */
export const MAX_SYNC_ATTEMPTS = 8;

const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  3 * 60 * 60_000,
  6 * 60 * 60_000,
];

/** Backoff after the n-th failed attempt (1-based). */
export function retryDelayMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), RETRY_DELAYS_MS.length) - 1;
  return RETRY_DELAYS_MS[index] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 60_000;
}

/** A sync stuck in "processing" longer than this is considered abandoned and retried. */
export const SYNC_LEASE_MS = 5 * 60_000;

/** Next state of a sync row after an attempt. */
export function nextSyncState(
  outcome: SyncOutcome,
  attempts: number,
  now: Date,
): { status: SyncStatus; nextAttemptAt?: Date; errorCode?: SyncErrorCode } {
  if (outcome.status === "synced") return { status: "synced" };
  if (outcome.status === "failed" || attempts >= MAX_SYNC_ATTEMPTS) {
    return { status: "failed", errorCode: outcome.code };
  }
  return {
    status: "retry_required",
    nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)),
    errorCode: outcome.code,
  };
}
