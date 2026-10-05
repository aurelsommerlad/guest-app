/**
 * Guest access: the right of one reservation's guest to open their stay (ADR 0011).
 * Created per reservation, reached via a personal link or booking number + last name;
 * both paths end in the same guest session.
 */

/** PMS a reservation id belongs to. "mock" exists only outside production. */
export const RESERVATION_PROVIDERS = ["apaleo", "mock"] as const;
export type ReservationProvider = (typeof RESERVATION_PROVIDERS)[number];

export function isReservationProvider(value: string): value is ReservationProvider {
  return (RESERVATION_PROVIDERS as readonly string[]).includes(value);
}

export type GuestAccess = {
  id: string;
  tenantId: string;
  propertyId: string;
  unitId?: string;
  reservationProvider: ReservationProvider;
  externalReservationId: string;
  validFrom: Date;
  validUntil: Date;
  revokedAt?: Date;
};

/**
 * When guest access opens and closes, relative to the reservation. Defaults for now;
 * the structure allows tenant/property settings later (ADR 0004).
 */
export type AccessWindowPolicy = {
  opensDaysBeforeArrival: number;
  closesDaysAfterDeparture: number;
};

export const DEFAULT_ACCESS_WINDOW_POLICY: AccessWindowPolicy = {
  opensDaysBeforeArrival: 30,
  closesDaysAfterDeparture: 3,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeAccessWindow(
  stay: { arrivalAt: string; departureAt: string },
  policy: AccessWindowPolicy = DEFAULT_ACCESS_WINDOW_POLICY,
): { validFrom: Date; validUntil: Date } {
  const arrival = new Date(stay.arrivalAt).getTime();
  const departure = new Date(stay.departureAt).getTime();
  if (Number.isNaN(arrival) || Number.isNaN(departure) || departure < arrival) {
    throw new RangeError("Invalid stay dates");
  }
  return {
    validFrom: new Date(arrival - policy.opensDaysBeforeArrival * DAY_MS),
    validUntil: new Date(departure + policy.closesDaysAfterDeparture * DAY_MS),
  };
}

export type AccessState = "valid" | "not-yet-valid" | "expired" | "revoked";

/** Revocation wins over time; validFrom is inclusive, validUntil exclusive. */
export function evaluateAccess(
  access: Pick<GuestAccess, "validFrom" | "validUntil" | "revokedAt">,
  now: Date,
): AccessState {
  if (access.revokedAt && access.revokedAt.getTime() <= now.getTime()) return "revoked";
  if (now.getTime() < access.validFrom.getTime()) return "not-yet-valid";
  if (now.getTime() >= access.validUntil.getTime()) return "expired";
  return "valid";
}
