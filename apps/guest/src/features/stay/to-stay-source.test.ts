import { type PmsReservation } from "@up/core";
import { describe, expect, it } from "vitest";

import { type StayCardSource } from "./model";
import { StayMappingError, toStaySource } from "./to-stay-source";

const cards: readonly StayCardSource[] = [];
const options = { allowTestProperties: false, cardsFor: () => cards };

const reservation: PmsReservation = {
  provider: "apaleo",
  externalId: "ABCDEFGH-1",
  status: "in-house",
  arrivalAt: "2026-08-27T16:00:00+02:00",
  departureAt: "2026-08-31T10:00:00+02:00",
  externalPropertyId: "ALTUS",
  externalUnitId: "ALTUS-SWA",
  primaryGuest: { firstName: "Laura" },
};

function failure(input: PmsReservation, opts = options) {
  try {
    toStaySource(input, opts);
  } catch (error) {
    expect(error).toBeInstanceOf(StayMappingError);
    return (error as StayMappingError).reason;
  }
  throw new Error("expected a StayMappingError");
}

describe("toStaySource", () => {
  it("maps Apaleo ids to our property and unit via the registry", () => {
    expect(toStaySource(reservation, options)).toEqual({
      tenantId: "unique-places",
      guest: { firstName: "Laura" },
      property: {
        id: "hov",
        name: "HØV",
        spokenName: "Höv",
        location: "Altusried",
        timeZone: "Europe/Berlin",
      },
      unit: { id: "ros", name: "ROS" },
      reservation: {
        status: "in-house",
        checkInAt: "2026-08-27T16:00:00+02:00",
        checkOutAt: "2026-08-31T10:00:00+02:00",
      },
      cards,
    });
  });

  it("works without a first name", () => {
    expect(toStaySource({ ...reservation, primaryGuest: {} }, options).guest).toEqual({});
  });

  it("rejects unknown properties", () => {
    expect(failure({ ...reservation, externalPropertyId: "UNKNOWN" })).toBe("unknown-property");
  });

  it("rejects unknown and unassigned units", () => {
    expect(failure({ ...reservation, externalUnitId: "ALTUS-XXX" })).toBe("unknown-unit");
    const { externalUnitId: _unused, ...unassigned } = reservation;
    expect(failure(unassigned)).toBe("unit-not-assigned");
  });

  it("does not resolve units of another property", () => {
    expect(failure({ ...reservation, externalUnitId: "TEST-ZHF" })).toBe("unknown-unit");
  });

  it("allows the Apaleo test property only when test data is allowed", () => {
    const test = { ...reservation, externalPropertyId: "TEST", externalUnitId: "TEST-ZHF" };
    expect(failure(test)).toBe("test-property-not-allowed");
    expect(toStaySource(test, { ...options, allowTestProperties: true }).unit).toEqual({
      id: "test-ap-1",
      name: "Ap. 1",
    });
  });

  it("shows no stay for canceled or no-show reservations", () => {
    expect(failure({ ...reservation, status: "canceled" })).toBe("reservation-inactive");
    expect(failure({ ...reservation, status: "no-show" })).toBe("reservation-inactive");
  });

  it("keeps checked-out reservations (post-departure)", () => {
    expect(
      toStaySource({ ...reservation, status: "checked-out" }, options).reservation.status,
    ).toBe("checked-out");
  });
});
