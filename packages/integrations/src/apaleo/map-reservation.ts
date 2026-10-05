import { type PmsReservation, type PmsReservationStatus } from "@up/core";

import { type ApaleoReservation } from "./schemas";

const statusMap: Record<ApaleoReservation["status"], PmsReservationStatus> = {
  Confirmed: "confirmed",
  InHouse: "in-house",
  CheckedOut: "checked-out",
  Canceled: "canceled",
  NoShow: "no-show",
};

/** Apaleo reservation → provider-neutral PMS reservation. */
export function mapApaleoReservation(reservation: ApaleoReservation): PmsReservation {
  const firstName = reservation.primaryGuest?.firstName?.trim();
  return {
    provider: "apaleo",
    externalId: reservation.id,
    status: statusMap[reservation.status],
    arrivalAt: reservation.arrival,
    departureAt: reservation.departure,
    externalPropertyId: reservation.property.id,
    ...(reservation.unit ? { externalUnitId: reservation.unit.id } : {}),
    primaryGuest: firstName ? { firstName } : {},
  };
}
