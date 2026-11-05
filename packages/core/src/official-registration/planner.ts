/**
 * Decides the next step for one registration (ADR 0022). Pure; one operation per run.
 *
 * Lifecycle (where the interface supports it):
 *   none ─► pre-registered (Voranmeldung, changeable) ─► registered (Meldeschein, binding,
 *   on the configured registration day) ─► checked-out (after departure)
 *   cancellation: pre-registration deleted; a binding registration goes to staff unless the
 *   interface documents a cancellation.
 *
 * Anything the interface cannot do (capabilities false) ends in "manual" – never guessed.
 */
import {
  type ManualReason,
  type OfficialOperation,
  type OfficialRegistrationState,
  type ProviderCapabilities,
} from "./model";
import { type OfficialGateResult } from "./gate";
import { isCancelled, sameStayDates, type StayFacts } from "./stay-facts";

export type OfficialPlan =
  | { kind: "execute"; operation: OfficialOperation }
  | { kind: "wait"; reason: "gate-closed" | "before-registration-day" | "backoff" | "staying" }
  | { kind: "manual"; reason: ManualReason }
  | { kind: "done"; reason: "nothing-to-transmit" | "completed" | "cancelled" | "awaiting-staff" };

export type PlanInput = {
  state: OfficialRegistrationState;
  stay: StayFacts;
  gate: OfficialGateResult;
  capabilities: ProviderCapabilities;
  /** Fingerprints of the payload built from the current data. */
  fingerprint: string;
  guestFingerprint: string;
  /** Local date (YYYY-MM-DD) in the property's time zone. */
  today: string;
  /** Local date of the binding registration (settings: bindingRegistrationDate). */
  registrationDay: string;
  /** First local date for a pre-registration (settings: preRegistrationOpensOn). */
  preRegistrationFrom?: string;
  now: Date;
};

function can(capabilities: ProviderCapabilities, operation: OfficialOperation): OfficialPlan {
  return capabilities[operation]
    ? { kind: "execute", operation }
    : { kind: "manual", reason: "not-supported" };
}

export function planOfficialRegistration(input: PlanInput): OfficialPlan {
  const { state, stay, capabilities } = input;

  if (state.transmission === "manual" || state.transmission === "failed") {
    return { kind: "done", reason: "awaiting-staff" };
  }
  if (state.unresolved) {
    return capabilities["lookup-by-reference"]
      ? { kind: "execute", operation: "lookup-by-reference" }
      : { kind: "manual", reason: "ambiguous-outcome" };
  }
  if (state.nextAttemptAt && state.nextAttemptAt.getTime() > input.now.getTime()) {
    return { kind: "wait", reason: "backoff" };
  }

  // Cancellations (and no-shows) from the PMS.
  if (isCancelled(stay)) {
    switch (state.stage) {
      case "none":
        return { kind: "done", reason: "nothing-to-transmit" };
      case "pre-registered":
        return can(capabilities, "delete-pre-registration");
      case "registered":
        return capabilities["cancel-registration"]
          ? { kind: "execute", operation: "cancel-registration" }
          : { kind: "manual", reason: "cancelled-after-registration" };
      case "checked-out":
      case "cancelled":
        return { kind: "done", reason: "cancelled" };
    }
  }

  const changed = input.fingerprint !== state.acceptedFingerprint;
  const guestsChanged =
    state.acceptedGuestFingerprint !== undefined &&
    input.guestFingerprint !== state.acceptedGuestFingerprint;

  switch (state.stage) {
    case "none": {
      if (!input.gate.open) return { kind: "wait", reason: "gate-closed" };
      const registrationDay = input.today >= input.registrationDay;
      const preRegistrationOpen =
        input.preRegistrationFrom === undefined || input.today >= input.preRegistrationFrom;
      if (!registrationDay && preRegistrationOpen && capabilities["create-pre-registration"]) {
        return { kind: "execute", operation: "create-pre-registration" };
      }
      if (!registrationDay) return { kind: "wait", reason: "before-registration-day" };
      return can(capabilities, "create-registration");
    }
    case "pre-registered": {
      if (changed) {
        if (!input.gate.open) return { kind: "wait", reason: "gate-closed" };
        return can(capabilities, "update-pre-registration");
      }
      if (input.today >= input.registrationDay) return can(capabilities, "convert-to-registration");
      return { kind: "wait", reason: "before-registration-day" };
    }
    case "registered": {
      // Binding form: only the departure may move (if the interface supports it).
      if (
        guestsChanged ||
        (state.acceptedStay && state.acceptedStay.arrivalDate !== stay.arrivalDate)
      ) {
        return { kind: "manual", reason: "registration-immutable" };
      }
      if (!sameStayDates(state.acceptedStay, stay)) {
        return capabilities["update-departure"]
          ? { kind: "execute", operation: "update-departure" }
          : { kind: "manual", reason: "registration-immutable" };
      }
      if (stay.status === "checked-out" || input.today > stay.departureDate) {
        return can(capabilities, "check-out");
      }
      return { kind: "wait", reason: "staying" };
    }
    case "checked-out":
      return changed
        ? { kind: "manual", reason: "changed-after-check-out" }
        : { kind: "done", reason: "completed" };
    case "cancelled":
      return { kind: "done", reason: "cancelled" };
  }
}
