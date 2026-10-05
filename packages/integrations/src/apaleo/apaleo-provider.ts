import { type Logger, type PmsProvider, type PmsReservation } from "@up/core";

import { ApaleoClient, type ApaleoClientOptions } from "./apaleo-client";
import { mapApaleoReservation } from "./map-reservation";
import { apaleoReservationSchema } from "./schemas";

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
