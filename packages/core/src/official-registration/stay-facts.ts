/**
 * Stay facts from the PMS (Apaleo) – the source for changes and cancellations after the
 * check-in was submitted. Re-read on every run; never taken from the guest.
 */
import { localDateOf } from "../journey/guest-journey";
import { type PmsReservation, type PmsReservationStatus } from "../pms/pms-provider";
import { type StayDates } from "./model";

export type StayFacts = StayDates & {
  status: PmsReservationStatus;
  guestCount?: number;
};

export function stayFactsFromReservation(reservation: PmsReservation, timeZone: string): StayFacts {
  const arrival = new Date(reservation.arrivalAt);
  const departure = new Date(reservation.departureAt);
  if (Number.isNaN(arrival.getTime()) || Number.isNaN(departure.getTime())) {
    throw new RangeError("Invalid reservation dates");
  }
  return {
    status: reservation.status,
    arrivalDate: localDateOf(arrival, timeZone),
    departureDate: localDateOf(departure, timeZone),
    ...(reservation.guestCount
      ? { guestCount: reservation.guestCount.adults + reservation.guestCount.children }
      : {}),
  };
}

export function isCancelled(stay: StayFacts): boolean {
  return stay.status === "canceled" || stay.status === "no-show";
}

export function sameStayDates(a: StayDates | undefined, b: StayDates): boolean {
  return a !== undefined && a.arrivalDate === b.arrivalDate && a.departureDate === b.departureDate;
}
