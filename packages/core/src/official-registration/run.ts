/**
 * One worker step for one registration (ADR 0022): plan → (execute) → apply. Persistence and
 * scheduling come in F2; in F1 this runs against simulated providers only.
 *
 * Logs: ids, operation, result and codes – never payload values.
 */
import { type Logger } from "../logging/logger";
import { guestCardAfterRegistration } from "./admin-actions";
import { type OfficialGateResult } from "./gate";
import { type OfficialRegistrationState, type OperationLogEntry } from "./model";
import { applyOutcome, markManual, type ProviderOutcome } from "./outcome";
import {
  guestDataFingerprint,
  idempotencyKey,
  type OfficialRegistrationPayload,
  payloadFingerprint,
} from "./payload";
import { type OfficialPlan, planOfficialRegistration } from "./planner";
import { type OfficialRegistrationProvider } from "./provider";
import { type StayFacts } from "./stay-facts";

export type RunInput = {
  state: OfficialRegistrationState;
  /** Built from the current registration and the current PMS stay dates. */
  payload: OfficialRegistrationPayload;
  stay: StayFacts;
  gate: OfficialGateResult;
  today: string;
};

export type RunResult = {
  plan: OfficialPlan;
  state: OfficialRegistrationState;
  log: OperationLogEntry[];
};

export async function runOfficialRegistration(
  deps: { provider: OfficialRegistrationProvider; now: () => Date; logger: Logger },
  input: RunInput,
): Promise<RunResult> {
  const fingerprint = payloadFingerprint(input.payload);
  const guestFingerprint = guestDataFingerprint(input.payload);
  const now = deps.now();
  const plan = planOfficialRegistration({
    state: input.state,
    stay: input.stay,
    gate: input.gate,
    capabilities: deps.provider.capabilities,
    fingerprint,
    guestFingerprint,
    today: input.today,
    now,
  });

  const base = { plan };
  if (plan.kind === "manual") {
    const handed = markManual(input.state, plan.reason, now);
    deps.logger.warn("official registration needs staff", {
      registrationId: input.state.registrationId,
      target: input.state.target,
      reason: plan.reason,
    });
    return { ...base, state: handed.state, log: handed.state === input.state ? [] : [handed.log] };
  }
  if (plan.kind !== "execute") return { ...base, state: input.state, log: [] };

  const key =
    plan.operation === "lookup-by-reference" && input.state.unresolved
      ? input.state.unresolved.idempotencyKey
      : idempotencyKey(input.state.registrationId, plan.operation, fingerprint);
  let outcome: ProviderOutcome;
  try {
    outcome = await deps.provider.execute({
      operation: plan.operation,
      payload: input.payload,
      ...(input.state.externalReference
        ? { externalReference: input.state.externalReference }
        : {}),
      idempotencyKey: key,
      propertyId: input.state.propertyId,
    });
  } catch (error) {
    // Unexpected failure inside the adapter: treat as "may have been sent".
    deps.logger.error("official registration adapter crashed", {
      registrationId: input.state.registrationId,
      operation: plan.operation,
      error: error instanceof Error ? { name: error.name } : "unknown",
    });
    outcome = { kind: "ambiguous", code: "unknown" };
  }

  const applied = applyOutcome({
    state: input.state,
    operation: plan.operation,
    outcome,
    idempotencyKey: key,
    fingerprint,
    guestFingerprint,
    stay: { arrivalDate: input.stay.arrivalDate, departureDate: input.stay.departureDate },
    now,
  });
  let state = applied.state;
  if (outcome.kind === "ok" && !outcome.guestCard && !deps.provider.capabilities.guestCardStatus) {
    const card = guestCardAfterRegistration(state, input.payload.guestCardEmail !== undefined);
    if (card !== state.guestCard.status)
      state = { ...state, guestCard: { status: card, updatedAt: now } };
  }
  deps.logger.info("official registration attempt", {
    registrationId: state.registrationId,
    target: state.target,
    operation: plan.operation,
    result: applied.log.result,
    ...(applied.log.code ? { code: applied.log.code } : {}),
    stage: state.stage,
    transmission: state.transmission,
    guestCard: state.guestCard.status,
  });
  return { plan, state, log: [applied.log] };
}
