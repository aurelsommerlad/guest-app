import { type PmsReservation } from "@up/core";

import { findPropertyByPmsId, type RegisteredProperty } from "../../config/properties";
import { type StayCardSource, type StaySource } from "./model";

export type StayMappingFailure =
  /** The PMS property is not in our registry. */
  | "unknown-property"
  /** A test property was resolved where test data is not allowed (production). */
  | "test-property-not-allowed"
  /** No unit is assigned to the reservation yet. */
  | "unit-not-assigned"
  /** The assigned PMS unit is not in our registry. */
  | "unknown-unit"
  /** Canceled or no-show reservations have no stay to show. */
  | "reservation-inactive";

/** Raised when a PMS reservation cannot be shown as a stay. Message contains no guest data. */
export class StayMappingError extends Error {
  readonly reason: StayMappingFailure;

  constructor(reason: StayMappingFailure) {
    super(`Reservation cannot be shown as a stay: ${reason}`);
    this.name = "StayMappingError";
    this.reason = reason;
  }
}

export type StaySourceOptions = {
  /** Whether test properties (e.g. Apaleo "TEST") may be resolved. False in production. */
  allowTestProperties: boolean;
  cardsFor: (propertyId: string) => readonly StayCardSource[];
};

/**
 * Provider-neutral reservation → our stay source. Identity (property, unit) comes
 * exclusively from the registry via stable PMS ids – never from PMS display names.
 */
export function toStaySource(reservation: PmsReservation, options: StaySourceOptions): StaySource {
  if (reservation.status === "canceled" || reservation.status === "no-show") {
    throw new StayMappingError("reservation-inactive");
  }

  const property: RegisteredProperty | undefined = findPropertyByPmsId(
    reservation.provider,
    reservation.externalPropertyId,
  );
  if (!property) throw new StayMappingError("unknown-property");
  if (property.testOnly && !options.allowTestProperties)
    throw new StayMappingError("test-property-not-allowed");

  if (!reservation.externalUnitId) throw new StayMappingError("unit-not-assigned");
  const unit = property.units.find(
    (candidate) => candidate.externalId === reservation.externalUnitId,
  );
  if (!unit) throw new StayMappingError("unknown-unit");

  return {
    tenantId: property.tenantId,
    guest: reservation.primaryGuest.firstName
      ? { firstName: reservation.primaryGuest.firstName }
      : {},
    property: {
      id: property.id,
      name: property.name,
      spokenName: property.spokenName,
      location: property.location,
      timeZone: property.timeZone,
    },
    unit: { id: unit.id, name: unit.name },
    reservation: {
      status: reservation.status,
      checkInAt: reservation.arrivalAt,
      checkOutAt: reservation.departureAt,
      ...(reservation.guestCount ? { guestCount: reservation.guestCount } : {}),
    },
    cards: options.cardsFor(property.id),
  };
}
