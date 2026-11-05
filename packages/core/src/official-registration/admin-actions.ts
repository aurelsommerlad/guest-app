/**
 * Staff actions (ADR 0022). Every action is logged with the admin id; nothing here talks to
 * the target – the next worker run does, with all gates checked again.
 */
import {
  type GuestCardStatus,
  type OfficialRegistrationState,
  type OperationLogEntry,
  type RemoteStage,
} from "./model";

type ActionResult =
  | { ok: true; state: OfficialRegistrationState; log: OperationLogEntry }
  | { ok: false; reason: string };

function entry(
  state: OfficialRegistrationState,
  operation: OperationLogEntry["operation"],
  result: OperationLogEntry["result"],
  adminUserId: string,
  at: Date,
): OperationLogEntry {
  return {
    registrationId: state.registrationId,
    target: state.target,
    at,
    operation,
    result,
    actor: { kind: "admin", adminUserId },
    stageAfter: state.stage,
    transmissionAfter: state.transmission,
  };
}

/**
 * "Erneut übertragen": only from failed/manual. An unresolved creating call is kept – it
 * must be reconciled first (lookup or staff resolution), never re-sent blindly.
 */
export function requestRetry(
  state: OfficialRegistrationState,
  adminUserId: string,
  now: Date,
): ActionResult {
  if (!adminUserId.trim()) return { ok: false, reason: "admin-required" };
  if (state.transmission !== "failed" && state.transmission !== "manual") {
    return { ok: false, reason: "not-retryable" };
  }
  if (state.unresolved && state.manualReason === "ambiguous-outcome") {
    return { ok: false, reason: "resolve-ambiguity-first" };
  }
  const next: OfficialRegistrationState = {
    ...state,
    transmission: state.externalReference ? "confirmed" : "pending",
    attempts: 0,
    version: state.version + 1,
  };
  delete next.manualReason;
  delete next.nextAttemptAt;
  delete next.lastErrorCode;
  return { ok: true, state: next, log: entry(next, "admin-retry", "ok", adminUserId, now) };
}

/**
 * Staff handled it at the target (e.g. in the Feratel web client) and records what is there
 * now. Clears an unresolved call. The reference is optional (staff may not see one).
 */
export function resolveManually(
  state: OfficialRegistrationState,
  input: {
    adminUserId: string;
    stage: RemoteStage;
    externalReference?: string;
    /** Fingerprint/stay of the current data, which staff confirmed is at the target. */
    acceptedFingerprint?: string;
    acceptedGuestFingerprint?: string;
    acceptedStay?: OfficialRegistrationState["acceptedStay"];
    now: Date;
  },
): ActionResult {
  if (!input.adminUserId.trim()) return { ok: false, reason: "admin-required" };
  const reference = input.externalReference?.trim();
  if (reference !== undefined && (reference.length === 0 || reference.length > 255)) {
    return { ok: false, reason: "invalid-reference" };
  }
  const next: OfficialRegistrationState = {
    ...state,
    stage: input.stage,
    transmission: input.stage === "none" ? "pending" : reference ? "confirmed" : "transmitted",
    attempts: 0,
    version: state.version + 1,
    ...(reference ? { externalReference: reference } : {}),
    ...(input.acceptedFingerprint ? { acceptedFingerprint: input.acceptedFingerprint } : {}),
    ...(input.acceptedGuestFingerprint
      ? { acceptedGuestFingerprint: input.acceptedGuestFingerprint }
      : {}),
    ...(input.acceptedStay ? { acceptedStay: { ...input.acceptedStay } } : {}),
  };
  delete next.unresolved;
  delete next.manualReason;
  delete next.nextAttemptAt;
  delete next.lastErrorCode;
  return {
    ok: true,
    state: next,
    log: entry(next, "admin-resolve", "ok", input.adminUserId, input.now),
  };
}

/**
 * Guest card status – a separate track. Changing it never touches the registration status
 * (and a failed card never re-sends the registration).
 */
export function updateGuestCard(
  state: OfficialRegistrationState,
  status: GuestCardStatus,
  actor: OperationLogEntry["actor"],
  now: Date,
): { state: OfficialRegistrationState; log: OperationLogEntry } {
  if (state.guestCard.status === "not-applicable" && status !== "not-applicable") {
    // A property without guest cards does not get one by accident.
    return {
      state,
      log: { ...entry(state, "guest-card-update", "skipped", "", now), actor },
    };
  }
  const next = { ...state, guestCard: { status, updatedAt: now }, version: state.version + 1 };
  return { state: next, log: { ...entry(next, "guest-card-update", "ok", "", now), actor } };
}

/**
 * Derived card status after a registration change, when the target does not report one:
 * once the registration with the guest e-mail is at the target, the card is "requested"
 * (the target issues and sends it). Without e-mail it needs staff.
 */
export function guestCardAfterRegistration(
  state: OfficialRegistrationState,
  hasGuestCardEmail: boolean,
): GuestCardStatus {
  const current = state.guestCard.status;
  if (current === "not-applicable") return current;
  if (state.stage === "cancelled") return current === "waiting" ? "not-applicable" : current;
  if (state.stage === "none") return "waiting";
  if (current === "issued" || current === "delivered" || current === "failed") return current;
  return hasGuestCardEmail ? "requested" : "manual";
}
