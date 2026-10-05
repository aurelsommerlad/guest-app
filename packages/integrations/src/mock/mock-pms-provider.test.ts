import { PmsError, type PmsReservation } from "@up/core";
import { describe, expect, it } from "vitest";

import { MockPmsProvider } from "./mock-pms-provider";

const reservation: PmsReservation = {
  provider: "mock",
  externalId: "MOCK-1",
  status: "in-house",
  arrivalAt: "2026-08-27T16:00:00+02:00",
  departureAt: "2026-08-31T10:00:00+02:00",
  externalPropertyId: "ALTUS",
  externalUnitId: "ALTUS-SWA",
  primaryGuest: { firstName: "Laura" },
};

describe("MockPmsProvider", () => {
  it("returns configured reservations", async () => {
    await expect(new MockPmsProvider([reservation]).getReservation("MOCK-1")).resolves.toEqual(
      reservation,
    );
  });

  it("rejects unknown reservations like a real provider", async () => {
    await expect(new MockPmsProvider([]).getReservation("X")).rejects.toBeInstanceOf(PmsError);
  });
});
