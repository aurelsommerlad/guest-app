import { createLogger } from "@up/core";
import { describe, expect, it } from "vitest";

import { stayCardsForProperty } from "../../mocks/content/stay-cards";
import { createMockPms } from "../../mocks/stay/mock-pms";
import { MOCK_LIVE_RESERVATION_ID, MOCK_RESERVATION_ID } from "../../mocks/stay/mock-stay";
import { type CurrentGuestAccess } from "../guest-access/guest-access-service";
import { loadSessionStay, StayUnavailableError } from "./session-stay";

const now = new Date("2026-10-05T12:00:00Z");
const access: CurrentGuestAccess = {
  guestAccessId: "00000000-0000-4000-8000-000000000001",
  tenantId: "unique-places",
  propertyId: "hov",
  unitId: "ros",
  reservationProvider: "mock",
  externalReservationId: MOCK_LIVE_RESERVATION_ID,
};
const deps = {
  pms: createMockPms(now),
  locale: "de" as const,
  now,
  sourceOptions: { allowTestProperties: true, cardsFor: stayCardsForProperty },
  logger: createLogger({ sink: () => undefined }),
};

describe("loadSessionStay (mock PMS via guest access)", () => {
  it("loads the reservation of the guest access and builds the stay view model", async () => {
    const stay = await loadSessionStay(access, deps);
    expect(stay.kind).toBe("stay");
    if (stay.kind !== "stay") return;
    expect(stay.viewModel.property.name).toBe("HØV");
    expect(stay.viewModel.unit.name).toBe("ROS");
    expect(stay.viewModel.guest.firstName).toBe("Laura");
  });

  it("treats a reservation of another property or tenant as invalid access", async () => {
    expect(await loadSessionStay({ ...access, propertyId: "huesle" }, deps)).toEqual({
      kind: "access-invalid",
    });
    expect(await loadSessionStay({ ...access, tenantId: "other" }, deps)).toEqual({
      kind: "access-invalid",
    });
  });

  it("treats canceled reservations as invalid access", async () => {
    const canceledPms = {
      name: "mock",
      getReservation: async () => ({
        ...(await deps.pms.getReservation(MOCK_RESERVATION_ID)),
        externalId: access.externalReservationId,
        status: "canceled" as const,
      }),
      findReservationsByBookingReference: () => Promise.resolve([]),
    };
    expect(await loadSessionStay(access, { ...deps, pms: canceledPms })).toEqual({
      kind: "access-invalid",
    });
  });

  it("raises a neutral error when the PMS is unavailable", async () => {
    await expect(loadSessionStay(access, { ...deps, pms: undefined })).rejects.toBeInstanceOf(
      StayUnavailableError,
    );
    await expect(
      loadSessionStay({ ...access, externalReservationId: "UNKNOWN" }, deps),
    ).rejects.toBeInstanceOf(StayUnavailableError);
  });
});
