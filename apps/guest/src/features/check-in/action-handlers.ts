import "server-only";

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
 * Handlers behind the check-in server actions – shared by every design of the check-in
 * (current app under "/check-in", design V2 under "/v2/check-in"). The only difference is
 * where the guest is sent afterwards: `base` is a fixed constant of the calling action file,
 * never input. The registration is always resolved from the session's reservation; the
 * form carries no ids – only the draft version for optimistic concurrency.
 */
export type CheckInBase = "/check-in" | "/v2/check-in";

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

export async function handleConfirmTrip(
  base: CheckInBase,
  locale: Locale,
): Promise<CheckInFormState> {
  const context = await currentContext();
  if (!context) return redirect({ href: "/login", locale });
  const result = await confirmTrip(checkInDeps(), context);
  if (result.ok || result.reason === "submitted") return redirect({ href: base, locale });
  return { status: result.reason === "invalid" ? "invalid" : result.reason };
}

export async function handleSaveStep(
  base: CheckInBase,
  locale: Locale,
  step: GuestStep,
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
  if (result.ok || result.reason === "submitted") return redirect({ href: base, locale });
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

export async function handleSubmitCheckIn(
  base: CheckInBase,
  locale: Locale,
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
    return redirect({ href: base, locale });
  }
  if (result.reason === "incomplete") return redirect({ href: base, locale });
  return { status: result.reason };
}
