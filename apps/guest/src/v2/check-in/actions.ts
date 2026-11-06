"use server";

import {
  type CheckInFormState,
  type VerificationFormState,
  handleConfirmEmailCode,
  handleConfirmTrip,
  handleSaveBilling,
  handleSaveStep,
  handleSendEmailCode,
  handleSubmitCheckIn,
} from "../../features/check-in/action-handlers";
import { type GuestStep } from "../../features/check-in/check-in-service";
import { type Locale } from "../../i18n/routing";

/**
 * Check-in server actions of design V2: the same handlers (and rules) as the current app –
 * afterwards the guest returns to "/v2/check-in" instead of "/check-in".
 */
export async function confirmTripV2(
  locale: Locale,
  _previous: CheckInFormState,
  _formData: FormData,
): Promise<CheckInFormState> {
  return handleConfirmTrip("/v2/check-in", locale);
}

export async function saveStepV2(
  locale: Locale,
  step: GuestStep,
  _previous: CheckInFormState,
  formData: FormData,
): Promise<CheckInFormState> {
  return handleSaveStep("/v2/check-in", locale, step, formData);
}

export async function saveBillingV2(
  locale: Locale,
  _previous: CheckInFormState,
  formData: FormData,
): Promise<CheckInFormState> {
  return handleSaveBilling("/v2/check-in", locale, formData);
}

export async function submitCheckInV2(
  locale: Locale,
  _previous: CheckInFormState,
  formData: FormData,
): Promise<CheckInFormState> {
  return handleSubmitCheckIn("/v2/check-in", locale, formData);
}

export async function sendEmailCodeV2(
  locale: Locale,
  _previous: VerificationFormState,
  _formData: FormData,
): Promise<VerificationFormState> {
  return handleSendEmailCode("/v2/check-in", locale);
}

export async function confirmEmailCodeV2(
  locale: Locale,
  _previous: VerificationFormState,
  formData: FormData,
): Promise<VerificationFormState> {
  return handleConfirmEmailCode("/v2/check-in", locale, formData);
}
