/**
 * What is handed to an official registration target (ADR 0022) – provider-neutral. The
 * adapter maps it onto the target's format once that format is documented (F4).
 *
 * Data minimisation: only legal registration fields of the travellers, plus the main guest's
 * confirmed e-mail so the target can send the guest card. No phone numbers, no internal ids
 * except our stable, non-personal reference.
 */
import { createHash } from "node:crypto";

import { splitGuestData } from "../registration/data-classification";
import {
  type RegistrationGuest,
  type RegistrationGuestData,
} from "../registration/registration-model";
import { ageOn, isValidIsoDate } from "../registration/dates";
import { type StayDates } from "./model";

export type OfficialGuest = {
  position: number;
  role: "primary" | "companion";
  /** Younger than the property's child age at arrival (tax / card categories). */
  child: boolean;
  data: Omit<RegistrationGuestData, "email" | "phone">;
};

export type OfficialRegistrationPayload = {
  /** Stable, non-personal reference for re-identification at the target. */
  reference: string;
  stay: StayDates;
  guests: OfficialGuest[];
  /** Only set when confirmed (or waived by staff) – used for the guest card e-mail. */
  guestCardEmail?: string;
};

export function officialReference(registrationId: string): string {
  return `up-${registrationId}`;
}

export function buildOfficialPayload(input: {
  registrationId: string;
  stay: StayDates;
  guests: readonly RegistrationGuest[];
  guestCount: number;
  childUnderAge: number;
  confirmedPrimaryEmail?: string;
}): OfficialRegistrationPayload {
  const guests = [...input.guests]
    .filter((guest) => guest.position < input.guestCount)
    .sort((a, b) => a.position - b.position)
    .map((guest): OfficialGuest => {
      const { legal } = splitGuestData(guest.data);
      const birthDate = legal.birthDate;
      const child =
        birthDate !== undefined &&
        isValidIsoDate(birthDate) &&
        ageOn(birthDate, input.stay.arrivalDate) < input.childUnderAge;
      return { position: guest.position, role: guest.role, child, data: legal };
    });
  return {
    reference: officialReference(input.registrationId),
    // Dates only – never the PMS status or other fields of a wider object passed in.
    stay: { arrivalDate: input.stay.arrivalDate, departureDate: input.stay.departureDate },
    guests,
    ...(input.confirmedPrimaryEmail ? { guestCardEmail: input.confirmedPrimaryEmail } : {}),
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** SHA-256 of the canonical payload – detects changes without storing the data. */
export function payloadFingerprint(payload: OfficialRegistrationPayload): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(payload)), "utf8")
    .digest("hex");
}

/** Fingerprint without the stay dates – tells "only the departure changed" apart. */
export function guestDataFingerprint(payload: OfficialRegistrationPayload): string {
  return payloadFingerprint({ ...payload, stay: { arrivalDate: "", departureDate: "" } });
}

/** Stable key per registration, operation and content – the target can dedupe on it. */
export function idempotencyKey(
  registrationId: string,
  operation: string,
  fingerprint: string,
): string {
  return createHash("sha256")
    .update(`${registrationId}|${operation}|${fingerprint}`, "utf8")
    .digest("hex");
}
