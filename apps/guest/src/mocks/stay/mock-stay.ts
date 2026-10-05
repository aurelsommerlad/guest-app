import { type PmsReservation } from "@up/core";

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
};
