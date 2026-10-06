import { type PmsReservation, type PmsReservationGuests } from "@up/core";

/*
 * Mock reservation for development and tests (STAY_DATA_SOURCE=mock).
 * Same shape as data from a real PMS provider, so mock and Apaleo mode share
 * one path: PmsReservation → StaySource → view model.
 */

export const MOCK_RESERVATION_ID = "MOCK-HOV-ROS";

/** Fixed "now" inside the stay, so the mock screen shows the in-house state. */
export const MOCK_NOW = new Date("2026-08-29T12:00:00+02:00");

export const mockReservation: PmsReservation = {
  // Simulates Apaleo data (served by MockPmsProvider), so it maps through the same registry.
  provider: "apaleo",
  externalId: MOCK_RESERVATION_ID,
  status: "in-house",
  arrivalAt: "2026-08-27T16:00:00+02:00",
  departureAt: "2026-08-31T10:00:00+02:00",
  // Mapped like real Apaleo data: ALTUS = HØV, ALTUS-SWA = ROS.
  externalPropertyId: "ALTUS",
  externalUnitId: "ALTUS-SWA",
  primaryGuest: { firstName: "Laura" },
  guestCount: { adults: 2, children: 1 },
};

/** Primary guest's last name of the mock reservations (for the booking number login). */
export const MOCK_GUEST_LAST_NAME = "Muster";

/**
 * Mock reservation for testing guest access locally (link and login): same unit, but
 * dated around the real "now", so its access window is open. The preview stay above
 * keeps its fixed dates.
 */
export const MOCK_LIVE_RESERVATION_ID = "MOCK-HOV-ROS-LIVE";

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayAt(base: Date, dayOffset: number, utcHour: number): string {
  const day = new Date(base.getTime() + dayOffset * DAY_MS);
  day.setUTCHours(utcHour, 0, 0, 0);
  return day.toISOString();
}

export function createLiveMockReservation(now: Date): PmsReservation {
  return {
    ...mockReservation,
    externalId: MOCK_LIVE_RESERVATION_ID,
    // Yesterday 16:00 → in three days 10:00 (Europe/Berlin summer time).
    arrivalAt: utcDayAt(now, -1, 14),
    departureAt: utcDayAt(now, 3, 8),
  };
}

/**
 * Guest data the mock PMS holds for the preview reservations (for prefilling the online
 * check-in): the main guest with a Booking.com relay e-mail (must not be prefilled) and a
 * mobile number, one known fellow traveller without phone, the third person unknown.
 * Fictitious; example data only.
 */
export const mockReservationGuests: PmsReservationGuests = {
  guests: [
    {
      firstName: "Laura",
      lastName: "Muster",
      email: "4h7k2m9x@guest.booking.com",
      phone: "+49 170 1234567",
      birthDate: "1990-05-17",
      nationality: "DE",
    },
    { firstName: "Tom", lastName: "Muster", birthDate: "1988-02-01", nationality: "AT" },
  ],
};
