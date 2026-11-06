import "server-only";

import { type BillingFieldIssue, type FieldError } from "@up/core";
import { after } from "next/server";

import { redirect } from "../../i18n/navigation";
import { type Locale } from "../../i18n/routing";
import { getGuestContext } from "../guest-context/server";
import { runRegistrationSync } from "../registration-sync/server";
import {
  type AddressSource,
  checkInAvailability,
  confirmTrip,
  effectiveStepFields,
  type GuestStep,
  saveBillingStep,
  saveGuestStep,
  sharedAddressOffered,
  stepFields,
  stepPositions,
  submitCheckIn,
} from "./check-in-service";
import { BILLING_FORM_FIELDS, parseStepValues } from "./form-model";
import {
  confirmVerificationCode,
  type ConfirmCodeResult,
  sendCodeIfDue,
  sendVerificationCode,
  type SendCodeResult,
} from "./contact-verification-service";
import { checkInDeps, verificationDeps } from "./server";

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
      status:
        | "invalid"
        | "conflict"
        | "rate-limited"
        | "unavailable"
        | "not-confirmed"
        | "contact-not-verified";
      errors?: Record<number, FieldError[]>;
      /** Billing step only. */
      billingErrors?: BillingFieldIssue[];
      values?: Record<string, string>;
      /** Invalid only: whether the step's valid values were saved (only fields missing). */
      saved?: boolean;
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
  const positions = stepPositions(journey, step);
  // "Same address as the main guest" travels as "g<position>.addressSource".
  const addressSources: Record<number, AddressSource> = {};
  for (const position of positions) {
    if (!sharedAddressOffered(journey, step, position)) continue;
    const shared = formData.get(`g${String(position)}.addressSource`) === "same-as-primary";
    addressSources[position] = shared ? "same-as-primary" : "own";
  }
  // Everything typed is echoed (also hidden address fields), so nothing is lost on an error;
  // only the fields that apply are passed on for saving.
  const { values: parsed, echo } = parseStepValues(formData, positions, (position) =>
    stepFields(journey, step, position),
  );
  const values: Record<number, Record<string, string>> = {};
  for (const position of positions) {
    const applies = new Set<string>(
      effectiveStepFields(journey, step, position, addressSources[position] ?? "own"),
    );
    values[position] = Object.fromEntries(
      Object.entries(parsed[position] ?? {}).filter(
        ([key]) => applies.has(key) || (key === "phoneCountry" && applies.has("phone")),
      ),
    );
  }
  for (const [position, source] of Object.entries(addressSources)) {
    echo[`g${position}.addressSource`] = source;
  }
  const result = await saveGuestStep(deps, context, {
    step,
    version: versionOf(formData),
    values,
    addressSources,
  });
  if (result.ok && step === "guests") {
    // The e-mail is entered here: send the code now, so it waits at the review (best effort).
    const saved = await checkInAvailability(deps, context);
    if (saved.available) await sendCodeIfDue(verificationDeps(), context, saved.journey, locale);
  }
  if (result.ok || result.reason === "submitted") return redirect({ href: base, locale });
  if (result.reason === "invalid") {
    return {
      status: "invalid",
      errors: result.errors,
      values: echo,
      saved: result.version !== undefined,
      ...(result.version ? { version: result.version } : {}),
    };
  }
  return { status: result.reason, values: echo };
}

export async function handleSaveBilling(
  base: CheckInBase,
  locale: Locale,
  formData: FormData,
): Promise<CheckInFormState> {
  const context = await currentContext();
  if (!context) return redirect({ href: "/login", locale });
  const values: Record<string, string> = {};
  for (const name of BILLING_FORM_FIELDS) {
    const raw = formData.get(name);
    if (typeof raw === "string") values[name] = raw.slice(0, 400);
  }
  const result = await saveBillingStep(checkInDeps(), context, {
    version: versionOf(formData),
    values,
  });
  if (result.ok || result.reason === "submitted") return redirect({ href: base, locale });
  if (result.reason === "invalid") {
    return { status: "invalid", billingErrors: result.issues, values, saved: false };
  }
  return { status: result.reason, values };
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

/* ------------------------------------------------------------------------------------------
 * Contact verification (ADR 0021, C4): code request and code entry on the review step.
 * ---------------------------------------------------------------------------------------- */

export type VerificationFormState =
  | { status: "idle" }
  | {
      status: "error";
      reason:
        | Exclude<SendCodeResult, { ok: true }>["reason"]
        | Exclude<ConfirmCodeResult, { ok: true }>["reason"];
      attemptsLeft?: number;
      retryAt?: string;
    };

export async function handleSendEmailCode(
  base: CheckInBase,
  locale: Locale,
): Promise<VerificationFormState> {
  const context = await currentContext();
  if (!context) return redirect({ href: "/login", locale });
  const result = await sendVerificationCode(verificationDeps(), context, {
    channel: "email",
    locale,
  });
  // Re-render the review with the new state (sent to, valid until) – no client-side state.
  if (result.ok || result.reason === "already-verified") {
    return redirect({ href: `${base}/review`, locale });
  }
  return {
    status: "error",
    reason: result.reason,
    ...(result.retryAt ? { retryAt: result.retryAt.toISOString() } : {}),
  };
}

export async function handleConfirmEmailCode(
  base: CheckInBase,
  locale: Locale,
  formData: FormData,
): Promise<VerificationFormState> {
  const context = await currentContext();
  if (!context) return redirect({ href: "/login", locale });
  const code = formData.get("code");
  const result = await confirmVerificationCode(verificationDeps(), context, {
    channel: "email",
    code: typeof code === "string" ? code : "",
  });
  if (result.ok) return redirect({ href: `${base}/review`, locale });
  return {
    status: "error",
    reason: result.reason,
    ...(result.attemptsLeft === undefined ? {} : { attemptsLeft: result.attemptsLeft }),
  };
}
