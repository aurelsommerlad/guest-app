/**
 * Apaleo write-back of the canonical online check-in (ADR 0016) – a GuestRegistrationProvider.
 *
 * Verified (official apaleo-maintained Booking API client 19.0.29, generated from the
 * API spec; see docs/integrations/apaleo-registration-writeback.md):
 *  - PATCH /booking/v1/reservations/{id} (JSON Patch), scope `reservations.manage`
 *  - allowed: "Replace PrimaryGuest", "Add, replace and remove AdditionalGuests"
 *  - GuestModel: firstName, lastName (required), email, phone, birthDate, nationalityCountryCode,
 *    address { addressLine1, postalCode, city, countryCode }, identificationNumber,
 *    identificationType (PassportNumber | IdNumber | … | Other)
 *
 * Never overwrites data we do not manage:
 *  - primaryGuest is read first and replaced by the *merged* object: unmanaged fields
 *    (company, preferences, a value we did not collect …) are written back unchanged.
 *    E-mail and phone are replaced by the guest's checked values (real e-mail, E.164).
 *  - additionalGuests are only written when the reservation has none, or when they are
 *    exactly what we wrote last time (fingerprint). Anything else → "conflict", nothing
 *    is written, a human decides.
 * Idempotent: the same submission produces the same patch; a retry is harmless.
 * Nothing of the reservation is stored or logged – only the sync outcome.
 */
import { createHash } from "node:crypto";

import {
  type DocumentType,
  type GuestRegistrationProvider,
  type Logger,
  PmsError,
  type RegistrationGuestData,
  type RegistrationSubmission,
  type SyncMemory,
  type SyncOutcome,
} from "@up/core";

import { type ApaleoClient, type JsonPatchOperation } from "./apaleo-client";
import { type ApaleoGuest, apaleoReservationGuestsSchema } from "./schemas";

const RESERVATION_ID_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,39}$/;

/** Our document types → Apaleo GuestModel.identificationType (verified enum values). */
const IDENTIFICATION_TYPES: Record<DocumentType, string> = {
  passport: "PassportNumber",
  "id-card": "IdNumber",
  other: "Other",
};

/** Canonical guest data merged onto an existing Apaleo guest (unmanaged fields kept). */
export function mergeApaleoGuest(
  existing: ApaleoGuest | undefined,
  data: RegistrationGuestData,
): ApaleoGuest {
  const guest: ApaleoGuest = { ...(existing ?? {}) };
  if (data.firstName) guest.firstName = data.firstName;
  if (data.lastName) guest.lastName = data.lastName;
  // The guest's own contact data replaces e.g. a channel relay address.
  if (data.email) guest.email = data.email;
  if (data.phone) guest.phone = data.phone;
  if (data.birthDate) guest.birthDate = data.birthDate;
  if (data.nationality) guest.nationalityCountryCode = data.nationality;
  if (data.street || data.postalCode || data.city || data.country) {
    guest.address = {
      ...(existing?.address ?? {}),
      ...(data.street ? { addressLine1: data.street } : {}),
      ...(data.postalCode ? { postalCode: data.postalCode } : {}),
      ...(data.city ? { city: data.city } : {}),
      ...(data.country ? { countryCode: data.country } : {}),
    };
  }
  if (data.documentNumber) {
    guest.identificationNumber = data.documentNumber;
    if (data.documentType) {
      guest.identificationType = IDENTIFICATION_TYPES[data.documentType as DocumentType];
    }
  }
  return guest;
}

/** SHA-256 over the managed fields of fellow travellers – identifies "our" list. */
export function additionalGuestsFingerprint(guests: readonly ApaleoGuest[]): string {
  const managed = guests.map((guest) => [
    guest.firstName ?? "",
    guest.lastName ?? "",
    guest.birthDate ?? "",
    guest.nationalityCountryCode ?? "",
  ]);
  return createHash("sha256").update(JSON.stringify(managed), "utf8").digest("hex");
}

function outcomeForError(error: unknown): SyncOutcome {
  if (!(error instanceof PmsError)) return { status: "retry", code: "unknown" };
  switch (error.kind) {
    case "auth":
      return { status: "failed", code: "auth" };
    case "not-found":
      return { status: "failed", code: "not_found" };
    case "timeout":
      return { status: "retry", code: "timeout" };
    case "unavailable":
      return { status: "retry", code: error.status === 429 ? "rate_limited" : "unavailable" };
    case "invalid-response":
      if (error.status === 409) return { status: "retry", code: "conflict" };
      if (error.status === 400 || error.status === 422)
        return { status: "failed", code: "rejected" };
      return { status: "failed", code: "unknown" };
  }
}

export class ApaleoRegistrationWriteBack implements GuestRegistrationProvider {
  readonly target = "apaleo" as const;
  readonly #client: ApaleoClient;
  readonly #log: Logger;

  constructor(client: ApaleoClient, logger: Logger) {
    this.#client = client;
    this.#log = logger.child({ provider: "apaleo", flow: "registration-writeback" });
  }

  async submit(submission: RegistrationSubmission, previous: SyncMemory): Promise<SyncOutcome> {
    const reservationId = submission.reservation.externalReservationId;
    if (
      submission.reservation.provider !== "apaleo" ||
      !RESERVATION_ID_PATTERN.test(reservationId)
    ) {
      return this.#done({ status: "failed", code: "invalid_data" }, submission);
    }
    const primary = submission.guests.find((guest) => guest.position === 0);
    if (!primary?.data.firstName || !primary.data.lastName) {
      return this.#done({ status: "failed", code: "invalid_data" }, submission);
    }
    const path = `/booking/v1/reservations/${encodeURIComponent(reservationId)}`;
    try {
      const current = await this.#client.get(
        path,
        apaleoReservationGuestsSchema,
        "registrationReadGuests",
      );
      if (current.status === "Canceled" || current.status === "NoShow") {
        return this.#done({ status: "failed", code: "rejected" }, submission);
      }

      const operations: JsonPatchOperation[] = [
        {
          op: "replace",
          path: "/primaryGuest",
          value: mergeApaleoGuest(current.primaryGuest, primary.data),
        },
      ];

      const companions = submission.guests
        .filter((guest) => guest.position > 0)
        .sort((a, b) => a.position - b.position)
        .map((guest) => mergeApaleoGuest(undefined, guest.data));
      const fingerprint = additionalGuestsFingerprint(companions);
      const existing = current.additionalGuests ?? [];
      const existingFingerprint = additionalGuestsFingerprint(existing);

      if (existing.length === 0) {
        if (companions.length > 0) {
          operations.push({
            op: current.additionalGuests ? "replace" : "add",
            path: "/additionalGuests",
            value: companions,
          });
        }
      } else if (existingFingerprint === fingerprint) {
        // Already exactly ours – nothing to write for fellow travellers.
      } else if (previous.fingerprint && existingFingerprint === previous.fingerprint) {
        // The list is the one we wrote before: ours to replace.
        operations.push({ op: "replace", path: "/additionalGuests", value: companions });
      } else {
        // Fellow travellers maintained elsewhere (front desk, channel): never overwrite.
        return this.#done({ status: "failed", code: "conflict" }, submission);
      }

      await this.#client.patch(path, operations, "registrationWriteBack");
      return this.#done(
        { status: "synced", externalReference: current.id, fingerprint },
        submission,
      );
    } catch (error) {
      return this.#done(outcomeForError(error), submission);
    }
  }

  #done(outcome: SyncOutcome, submission: RegistrationSubmission): SyncOutcome {
    // Ids and codes only – never guest data or Apaleo payloads.
    this.#log.info("registration write-back finished", {
      registrationId: submission.registrationId,
      tenantId: submission.tenantId,
      outcome: outcome.status,
      ...(outcome.status === "synced" ? {} : { code: outcome.code }),
    });
    return outcome;
  }
}
