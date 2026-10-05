import { PmsError, type PmsProvider, type PmsReservation } from "@up/core";

/** In-memory PMS for development and tests – same interface as real providers. */
export class MockPmsProvider implements PmsProvider {
  readonly name = "mock";
  readonly #reservations: ReadonlyMap<string, PmsReservation>;

  constructor(reservations: readonly PmsReservation[]) {
    this.#reservations = new Map(
      reservations.map((reservation) => [reservation.externalId, reservation]),
    );
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
