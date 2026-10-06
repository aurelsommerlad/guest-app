import {
  type PmsGuestData,
  type PmsReservation,
  type PmsReservationGuests,
  type PmsReservationStatus,
} from "@up/core";

import { type ApaleoPrefillGuest, type ApaleoReservation } from "./schemas";

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
    ...(reservation.adults === undefined
      ? {}
      : {
          guestCount: {
            adults: reservation.adults,
            children: reservation.childrenAges?.length ?? 0,
          },
        }),
  };
}

/** Apaleo identificationType → our document type (only the unambiguous ones). */
const DOCUMENT_TYPES: Record<string, string> = {
  PassportNumber: "passport",
  IdNumber: "id-card",
};

/** Apaleo GuestModel → our field names. Values stay unvalidated (core filters them). */
export function mapApaleoGuest(guest: ApaleoPrefillGuest): PmsGuestData {
  const pick = (value: string | undefined) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  };
  const entries: [keyof PmsGuestData, string | undefined][] = [
    ["firstName", pick(guest.firstName)],
    ["lastName", pick(guest.lastName)],
    ["email", pick(guest.email)],
    ["phone", pick(guest.phone)],
    // Apaleo dates may carry a time part; the date is what counts.
    ["birthDate", pick(guest.birthDate)?.slice(0, 10)],
    ["nationality", pick(guest.nationalityCountryCode)],
    ["street", pick(guest.address?.addressLine1)],
    ["postalCode", pick(guest.address?.postalCode)],
    ["city", pick(guest.address?.city)],
    ["country", pick(guest.address?.countryCode)],
    ["documentNumber", pick(guest.identificationNumber)],
    [
      "documentType",
      guest.identificationNumber && guest.identificationType
        ? DOCUMENT_TYPES[guest.identificationType]
        : undefined,
    ],
  ];
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

export function mapApaleoReservationGuests(reservation: {
  adults: number;
  childrenAges?: number[] | undefined;
  primaryGuest?: ApaleoPrefillGuest | undefined;
  additionalGuests?: ApaleoPrefillGuest[] | undefined;
}): PmsReservationGuests {
  return {
    occupancy: {
      adults: reservation.adults,
      children: reservation.childrenAges?.length ?? 0,
      ...(reservation.childrenAges ? { childrenAges: reservation.childrenAges } : {}),
    },
    guests: [
      reservation.primaryGuest ? mapApaleoGuest(reservation.primaryGuest) : {},
      ...(reservation.additionalGuests ?? []).map(mapApaleoGuest),
    ],
  };
}
