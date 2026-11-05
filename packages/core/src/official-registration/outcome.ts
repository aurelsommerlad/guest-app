/**
 * Applying a provider answer to the state (ADR 0022) – retries, backoff, ambiguity, staff.
 *
 * - temporary errors: retry with the existing backoff (registration-sync) up to
 *   MAX_SYNC_ATTEMPTS, then "failed";
 * - rejected data / missing permission: "failed" (a person fixes data or access);
 * - unknown outcome of a creating call (timeout after sending): the call is NOT repeated.
 *   It is remembered as `unresolved` and reconciled by reference lookup – or by staff;
 * - not supported: "manual".
 */
import { MAX_SYNC_ATTEMPTS, retryDelayMs } from "../registration/registration-sync";
import {
  CREATING_OPERATIONS,
  type GuestCardStatus,
  type ManualReason,
  type OfficialErrorCode,
  type OfficialOperation,
  type OfficialRegistrationState,
  type OperationLogEntry,
  type RemoteStage,
  type StayDates,
} from "./model";

export type ProviderOutcome =
  | {
      kind: "ok";
      externalReference?: string;
      /** For lookup-by-reference: the stage found at the target ("none" = not there). */
      foundStage?: RemoteStage;
      guestCard?: GuestCardStatus;
    }
  | { kind: "rejected"; code: OfficialErrorCode }
  | { kind: "temporary"; code: OfficialErrorCode }
  /** The request may have been processed – nobody knows. */
  | { kind: "ambiguous"; code: OfficialErrorCode }
  | { kind: "not-supported" };

const STAGE_AFTER: Partial<Record<OfficialOperation, RemoteStage>> = {
  "create-pre-registration": "pre-registered",
  "update-pre-registration": "pre-registered",
  "delete-pre-registration": "cancelled",
  "create-registration": "registered",
  "convert-to-registration": "registered",
  "update-departure": "registered",
  "check-out": "checked-out",
  "cancel-registration": "cancelled",
};

export type AppliedOutcome = { state: OfficialRegistrationState; log: OperationLogEntry };

export function applyOutcome(input: {
  state: OfficialRegistrationState;
  operation: OfficialOperation;
  outcome: ProviderOutcome;
  idempotencyKey: string;
  fingerprint: string;
  guestFingerprint: string;
  stay: StayDates;
  now: Date;
}): AppliedOutcome {
  const { state, operation, outcome, now } = input;
  const attempt = state.attempts + 1;
  let next: OfficialRegistrationState;
  let result: OperationLogEntry["result"];
  let code: OfficialErrorCode | undefined;

  const toStaff = (reason: ManualReason, status: "manual" | "failed" = "manual") => ({
    ...state,
    transmission: status,
    manualReason: reason,
    attempts: attempt,
    version: state.version + 1,
  });

  switch (outcome.kind) {
    case "ok": {
      result = "ok";
      const reference = outcome.externalReference ?? state.externalReference;
      const guestCard = outcome.guestCard
        ? { status: outcome.guestCard, updatedAt: now }
        : state.guestCard;
      if (operation === "lookup-by-reference") {
        const found = outcome.foundStage ?? "none";
        const sent = state.unresolved;
        next = {
          ...state,
          stage: found,
          // Nothing found: the unresolved call never arrived – plan from scratch.
          transmission: found === "none" ? "pending" : reference ? "confirmed" : "transmitted",
          attempts: 0,
          version: state.version + 1,
          ...(reference ? { externalReference: reference } : {}),
          ...(found !== "none" && sent
            ? {
                acceptedFingerprint: sent.fingerprint,
                acceptedGuestFingerprint: sent.guestFingerprint,
                acceptedStay: { ...sent.stay },
              }
            : {}),
          guestCard,
        };
      } else {
        next = {
          ...state,
          stage: STAGE_AFTER[operation] ?? state.stage,
          transmission: reference ? "confirmed" : "transmitted",
          attempts: 0,
          version: state.version + 1,
          ...(reference ? { externalReference: reference } : {}),
          acceptedFingerprint: input.fingerprint,
          acceptedGuestFingerprint: input.guestFingerprint,
          acceptedStay: { ...input.stay },
          guestCard,
        };
      }
      delete next.unresolved;
      delete next.nextAttemptAt;
      delete next.lastErrorCode;
      delete next.manualReason;
      break;
    }
    case "temporary": {
      result = "temporary";
      code = outcome.code;
      next =
        attempt >= MAX_SYNC_ATTEMPTS
          ? { ...toStaff("attempts-exhausted", "failed"), lastErrorCode: code }
          : {
              ...state,
              attempts: attempt,
              lastErrorCode: code,
              nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempt)),
              version: state.version + 1,
            };
      break;
    }
    case "rejected": {
      result = "rejected";
      code = outcome.code;
      next = { ...toStaff("rejected", "failed"), lastErrorCode: code };
      break;
    }
    case "ambiguous": {
      result = "ambiguous";
      code = outcome.code;
      if (CREATING_OPERATIONS.has(operation)) {
        next = {
          ...state,
          attempts: attempt,
          lastErrorCode: "ambiguous_outcome",
          unresolved: {
            operation,
            idempotencyKey: input.idempotencyKey,
            fingerprint: input.fingerprint,
            guestFingerprint: input.guestFingerprint,
            stay: { ...input.stay },
            at: now,
          },
          nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempt)),
          version: state.version + 1,
        };
      } else {
        // Updates/deletes/check-out are retried like temporary errors.
        next =
          attempt >= MAX_SYNC_ATTEMPTS
            ? { ...toStaff("attempts-exhausted", "failed"), lastErrorCode: code }
            : {
                ...state,
                attempts: attempt,
                lastErrorCode: code,
                nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempt)),
                version: state.version + 1,
              };
      }
      break;
    }
    case "not-supported": {
      result = "not-supported";
      code = "not_supported";
      next = { ...toStaff("not-supported"), lastErrorCode: code };
      break;
    }
  }

  return {
    state: next,
    log: {
      registrationId: state.registrationId,
      target: state.target,
      at: now,
      operation,
      result,
      ...(code ? { code } : {}),
      attempt,
      idempotencyKey: input.idempotencyKey,
      actor: { kind: "system" },
      stageAfter: next.stage,
      transmissionAfter: next.transmission,
    },
  };
}

/** Moves a registration to staff (planner said "manual"). Logged, idempotent. */
export function markManual(
  state: OfficialRegistrationState,
  reason: ManualReason,
  now: Date,
): AppliedOutcome {
  const next: OfficialRegistrationState =
    state.transmission === "manual" && state.manualReason === reason
      ? state
      : { ...state, transmission: "manual", manualReason: reason, version: state.version + 1 };
  return {
    state: next,
    log: {
      registrationId: state.registrationId,
      target: state.target,
      at: now,
      operation: "handover-to-staff",
      result: "manual",
      manualReason: reason,
      actor: { kind: "system" },
      stageAfter: next.stage,
      transmissionAfter: next.transmission,
    },
  };
}
