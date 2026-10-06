"use server";

import { type FieldError } from "@up/core";
import { after } from "next/server";

import { redirect } from "../../i18n/navigation";
import { type Locale } from "../../i18n/routing";
import { getGuestContext } from "../guest-context/server";
import { runRegistrationSync } from "../registration-sync/server";
import {
  checkInAvailability,
  confirmTrip,
  type GuestStep,
  saveGuestStep,
  stepFields,
  stepPositions,
  submitCheckIn,
} from "./check-in-service";
import { parseStepValues } from "./form-model";
import { checkInDeps } from "./server";

/**
 * Server actions of the check-in steps (Next.js checks the Origin of every action: CSRF
 * protection). The registration is always resolved from the session's reservation; the
 * form carries no ids – only the draft version for optimistic concurrency.
 */
export type CheckInFormState =
  | { status: "idle" }
  | {
      status: "invalid" | "conflict" | "rate-limited" | "unavailable" | "not-confirmed";
      errors?: Record<number, FieldError[]>;
      values?: Record<string, string>;
      version?: number;
    };

function versionOf(formData: FormData): number {
  const value = Number(formData.get("version"));
  return Number.isInteger(value) && value > 0 ? value : 0;
}

async function currentContext() {
  const result = await getGuestContext();
  return result.kind === "context" ? result.context : undefined;
}

export async function confirmTripAction(
  locale: Locale,
  _previous: CheckInFormState,
  // The number of travellers comes from the reservation – nothing is read from the form.
  _formData: FormData,
): Promise<CheckInFormState> {
  const context = await currentContext();
  if (!context) return redirect({ href: "/login", locale });
  const result = await confirmTrip(checkInDeps(), context);
  if (result.ok || result.reason === "submitted") return redirect({ href: "/check-in", locale });
  return { status: result.reason === "invalid" ? "invalid" : result.reason };
}

export async function saveStepAction(
  locale: Locale,
  step: GuestStep,
  _previous: CheckInFormState,
  formData: FormData,
): Promise<CheckInFormState> {
  const context = await currentContext();
  if (!context) return redirect({ href: "/login", locale });
  const deps = checkInDeps();
  const availability = await checkInAvailability(deps, context);
  if (!availability.available) return { status: "unavailable" };
  const journey = availability.journey;
  const { values, echo } = parseStepValues(formData, stepPositions(journey, step), (position) =>
    stepFields(journey, step, position),
  );
  const result = await saveGuestStep(deps, context, { step, version: versionOf(formData), values });
  if (result.ok || result.reason === "submitted") return redirect({ href: "/check-in", locale });
  if (result.reason === "invalid") {
    return {
      status: "invalid",
      errors: result.errors,
      values: echo,
      ...(result.version ? { version: result.version } : {}),
    };
  }
  return { status: result.reason, values: echo };
}

export async function submitCheckInAction(
  locale: Locale,
  _previous: CheckInFormState,
  formData: FormData,
): Promise<CheckInFormState> {
  const context = await currentContext();
  if (!context) return redirect({ href: "/login", locale });
  const result = await submitCheckIn(checkInDeps(), context, {
    version: versionOf(formData),
    confirmed: formData.get("confirm") === "yes",
  });
  if (result.ok) {
    // Provider syncs run after the response – the guest never waits for Apaleo/Feratel.
    if (result.newlySubmitted) after(() => runRegistrationSync(5));
    return redirect({ href: "/check-in", locale });
  }
  if (result.reason === "incomplete") return redirect({ href: "/check-in", locale });
  return { status: result.reason };
}
