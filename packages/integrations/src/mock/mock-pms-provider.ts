import {
  PmsError,
  type PmsProvider,
  type PmsReservation,
  type PmsReservationCandidate,
} from "@up/core";

/** In-memory PMS for development and tests – same interface as real providers. */
export class MockPmsProvider implements PmsProvider {
  readonly name = "mock";
  readonly #reservations: ReadonlyMap<string, PmsReservation>;
  readonly #lastNames: Readonly<Record<string, string>>;

  /** `guestLastNames`: reservation id → primary guest last name (for the login check). */
  constructor(
    reservations: readonly PmsReservation[],
    options: { guestLastNames?: Readonly<Record<string, string>> } = {},
  ) {
    this.#reservations = new Map(
      reservations.map((reservation) => [reservation.externalId, reservation]),
    );
    this.#lastNames = options.guestLastNames ?? {};
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
