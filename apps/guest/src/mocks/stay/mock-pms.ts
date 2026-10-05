import { MockPmsProvider } from "@up/integrations";

import {
  createLiveMockReservation,
  MOCK_GUEST_LAST_NAME,
  MOCK_LIVE_RESERVATION_ID,
  MOCK_RESERVATION_ID,
  mockReservation,
} from "./mock-stay";

/** In-memory PMS with the preview reservation and the live-dated guest access reservation. */
export function createMockPms(now: Date): MockPmsProvider {
  return new MockPmsProvider([mockReservation, createLiveMockReservation(now)], {
    guestLastNames: {
      [MOCK_RESERVATION_ID]: MOCK_GUEST_LAST_NAME,
      [MOCK_LIVE_RESERVATION_ID]: MOCK_GUEST_LAST_NAME,
    },
  });
}
