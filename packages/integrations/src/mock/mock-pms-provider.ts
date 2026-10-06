import {
  PmsError,
  type PmsProvider,
  type PmsReservation,
  type PmsReservationCandidate,
  type PmsReservationGuests,
} from "@up/core";

/** In-memory PMS for development and tests – same interface as real providers. */
export class MockPmsProvider implements PmsProvider {
  readonly name = "mock";
  readonly #reservations: ReadonlyMap<string, PmsReservation>;
  readonly #lastNames: Readonly<Record<string, string>>;
  readonly #guests: Readonly<Record<string, PmsReservationGuests>>;

  /**
   * `guestLastNames`: reservation id → primary guest last name (for the login check).
   * `guests`: reservation id → guest data for prefilling the online check-in.
   */
  constructor(
    reservations: readonly PmsReservation[],
    options: {
      guestLastNames?: Readonly<Record<string, string>>;
      guests?: Readonly<Record<string, PmsReservationGuests>>;
    } = {},
  ) {
    this.#reservations = new Map(
      reservations.map((reservation) => [reservation.externalId, reservation]),
    );
    this.#lastNames = options.guestLastNames ?? {};
    this.#guests = options.guests ?? {};
  }

  getReservationGuests(reservationId: string): Promise<PmsReservationGuests> {
    const reservation = this.#reservations.get(reservationId);
    if (!reservation) {
      return Promise.reject(
        new PmsError("not-found", "getReservationGuests: unknown mock reservation", {
          provider: this.name,
        }),
      );
    }
    const known = this.#guests[reservationId];
    return Promise.resolve({
      ...(reservation.guestCount ? { occupancy: reservation.guestCount } : {}),
      guests: known?.guests ?? [],
    });
  }

  findReservationsByBookingReference(reference: string): Promise<PmsReservationCandidate[]> {
    const reservation = this.#reservations.get(reference);
    if (!reservation) return Promise.resolve([]);
    const lastName = this.#lastNames[reference];
    return Promise.resolve([
      { reservation, ...(lastName ? { primaryGuestLastName: lastName } : {}) },
    ]);
  }

  getReservation(reservationId: string): Promise<PmsReservation> {
    const reservation = this.#reservations.get(reservationId);
    return reservation
      ? Promise.resolve(reservation)
      : Promise.reject(
          new PmsError("not-found", "getReservation: unknown mock reservation", {
            provider: this.name,
          }),
        );
  }
}
