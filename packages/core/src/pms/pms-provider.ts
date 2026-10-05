/**
 * PMS port – the only view of a property management system the app depends on.
 * Provider adapters (ApaleoProvider, …) map their API models onto these types,
 * so no provider-specific structure reaches the guest app.
 */

export type PmsReservationStatus =
  "confirmed" | "in-house" | "checked-out" | "canceled" | "no-show";

/** Minimal reservation data needed for the guest experience (data minimisation). */
export type PmsReservation = {
  /** Provider that delivered the data, e.g. "apaleo". */
  provider: string;
  /** Reservation id in the PMS. */
  externalId: string;
  status: PmsReservationStatus;
  /** Planned check-in instant (ISO 8601 with offset). */
  arrivalAt: string;
  /** Planned check-out instant (ISO 8601 with offset). */
  departureAt: string;
  /** Property id in the PMS – mapped to our property via configuration, never via its name. */
  externalPropertyId: string;
  /** Assigned unit id in the PMS; missing while no unit is assigned yet. */
  externalUnitId?: string;
  primaryGuest: {
    /** First name for the personal greeting; may be missing in the PMS. */
    firstName?: string;
  };
};

export interface PmsProvider {
  readonly name: string;
  /** Loads one reservation by its PMS id. Rejects with a `PmsError`. */
  getReservation(reservationId: string): Promise<PmsReservation>;
}

export type PmsErrorKind =
  /** Credentials rejected or missing permissions (scope). */
  | "auth"
  /** The reservation does not exist (or is not visible to this client). */
  | "not-found"
  /** No response within the time limit. */
  | "timeout"
  /** Network failure, rate limit or server error on the provider side. */
  | "unavailable"
  /** The provider answered with data we cannot use. */
  | "invalid-response";

/**
 * Error raised by PMS providers. The message is safe to log: it never contains
 * credentials, tokens, response bodies or guest data.
 */
export class PmsError extends Error {
  readonly kind: PmsErrorKind;
  readonly provider: string;
  readonly status?: number;

  constructor(kind: PmsErrorKind, message: string, details: { provider: string; status?: number }) {
    super(message);
    this.name = "PmsError";
    this.kind = kind;
    this.provider = details.provider;
    this.status = details.status;
  }
}
