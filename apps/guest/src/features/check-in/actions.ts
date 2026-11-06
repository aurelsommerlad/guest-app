"use server";

import { type Locale } from "../../i18n/routing";
import {
  type CheckInFormState,
  handleConfirmTrip,
  handleSaveBilling,
  handleSaveStep,
  handleSubmitCheckIn,
} from "./action-handlers";
import { type GuestStep } from "./check-in-service";

/**
 * Server actions of the check-in steps (Next.js checks the Origin of every action: CSRF
 * protection). Logic in action-handlers.ts; afterwards the guest returns to "/check-in".
 */
export type { CheckInFormState } from "./action-handlers";

export async function confirmTripAction(
  locale: Locale,
  _previous: CheckInFormState,
  // The number of travellers comes from the reservation – nothing is read from the form.
  _formData: FormData,
): Promise<CheckInFormState> {
  return handleConfirmTrip("/check-in", locale);
}

export async function saveStepAction(
  locale: Locale,
  step: GuestStep,
  _previous: CheckInFormState,
  formData: FormData,
): Promise<CheckInFormState> {
  return handleSaveStep("/check-in", locale, step, formData);
}

export async function saveBillingAction(
  locale: Locale,
  _previous: CheckInFormState,
  formData: FormData,
): Promise<CheckInFormState> {
  return handleSaveBilling("/check-in", locale, formData);
}

export async function submitCheckInAction(
  locale: Locale,
  _previous: CheckInFormState,
  formData: FormData,
): Promise<CheckInFormState> {
  return handleSubmitCheckIn("/check-in", locale, formData);
}
