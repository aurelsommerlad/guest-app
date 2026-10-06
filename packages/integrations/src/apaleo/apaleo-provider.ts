import {
  type Logger,
  PmsError,
  type PmsProvider,
  type PmsReservation,
  type PmsReservationCandidate,
  type PmsReservationGuests,
} from "@up/core";

import { ApaleoClient, type ApaleoClientOptions } from "./apaleo-client";
import { mapApaleoReservation, mapApaleoReservationGuests } from "./map-reservation";
import {
  apaleoReservationForLoginSchema,
  apaleoReservationPrefillSchema,
  apaleoReservationSchema,
} from "./schemas";

/** Apaleo reservation ids are uppercase letters, digits and hyphens (e.g. "ABCDEFGH-1"). */
const RESERVATION_ID_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,39}$/;

/** Apaleo implementation of the PMS port. */
export class ApaleoProvider implements PmsProvider {
  readonly name = "apaleo";
  readonly #client: ApaleoClient;

  constructor(client: ApaleoClient) {
    this.#client = client;
  }

  async getReservation(reservationId: string): Promise<PmsReservation> {
    // No `expand`: primaryGuest, property and unit are part of the base model.
    const reservation = await this.#client.get(
      `/booking/v1/reservations/${encodeURIComponent(reservationId)}`,
      apaleoReservationSchema,
      "getReservation",
    );
    return mapApaleoReservation(reservation);
  }

  /**
   * Occupancy (adults, childrenAges) and guest data for prefilling the online check-in –
   * same verified endpoint and scope (reservations.read), primaryGuest and additionalGuests
   * are part of the base model. Booker data is deliberately not used (may be an agency).
   */
  async getReservationGuests(reservationId: string): Promise<PmsReservationGuests> {
    const reservation = await this.#client.get(
      `/booking/v1/reservations/${encodeURIComponent(reservationId)}`,
      apaleoReservationPrefillSchema,
      "getReservationGuests",
    );
    return mapApaleoReservationGuests(reservation);
  }

  /**
   * Verified: GET /booking/v1/reservations/{id} (scope reservations.read) – exact id.
   * Not implemented on purpose: OTA numbers. The list endpoint's `externalCode` filter is
   * a prefix match and several reservations can share a code; `externalReferences` and
   * channel-specific semantics still need verification against real data (ADR 0011).
   */
  async findReservationsByBookingReference(reference: string): Promise<PmsReservationCandidate[]> {
    if (!RESERVATION_ID_PATTERN.test(reference)) return [];
    try {
      const reservation = await this.#client.get(
        `/booking/v1/reservations/${encodeURIComponent(reference)}`,
        apaleoReservationForLoginSchema,
        "findReservationForLogin",
      );
      const lastName = reservation.primaryGuest?.lastName;
      return [
        {
          reservation: mapApaleoReservation(reservation),
          ...(lastName ? { primaryGuestLastName: lastName } : {}),
        },
      ];
    } catch (error) {
      if (error instanceof PmsError && error.kind === "not-found") return [];
      throw error;
    }
  }
}

export function createApaleoProvider(
  options: {
    clientId: string;
    clientSecret: string;
    logger: Logger;
  } & Partial<Omit<ApaleoClientOptions, "clientId" | "clientSecret" | "logger">>,
): ApaleoProvider {
  return new ApaleoProvider(new ApaleoClient(options));
}
