import { describe, expect, it } from "vitest";

import { mapApaleoReservation } from "./map-reservation";
import { apaleoReservationSchema } from "./schemas";
import { apaleoReservationPayload } from "./test-helpers";

const parse = (overrides: Record<string, unknown> = {}) =>
  apaleoReservationSchema.parse(apaleoReservationPayload(overrides));

describe("mapApaleoReservation", () => {
  it("maps an Apaleo reservation onto the PMS model", () => {
    expect(mapApaleoReservation(parse())).toEqual({
      provider: "apaleo",
      externalId: "ABCDEFGH-1",
      status: "in-house",
      arrivalAt: "2026-08-27T16:00:00+02:00",
      departureAt: "2026-08-31T10:00:00+02:00",
      externalPropertyId: "ALTUS",
      externalUnitId: "ALTUS-SWA",
      primaryGuest: { firstName: "Laura" },
    });
  });

  it("keeps no data we do not need (last name, contact, address, prices)", () => {
    const serialized = JSON.stringify(mapApaleoReservation(parse()));
    for (const value of [
      "Muster",
      "laura@example.com",
      "+49 123 456",
      "Musterstraße",
      "840",
      "ROS No. 2",
      "HØV by",
    ]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("handles missing optional fields: unit, primary guest, first name", () => {
    expect(mapApaleoReservation(parse({ unit: undefined })).externalUnitId).toBeUndefined();
    expect(mapApaleoReservation(parse({ primaryGuest: undefined })).primaryGuest).toEqual({});
    expect(
      mapApaleoReservation(parse({ primaryGuest: { lastName: "Muster" } })).primaryGuest,
    ).toEqual({});
    expect(
      mapApaleoReservation(parse({ primaryGuest: { firstName: "  ", lastName: "X" } }))
        .primaryGuest,
    ).toEqual({});
  });

  it("maps every Apaleo status", () => {
    const statuses = {
      Confirmed: "confirmed",
      InHouse: "in-house",
      CheckedOut: "checked-out",
      Canceled: "canceled",
      NoShow: "no-show",
    };
    for (const [apaleo, internal] of Object.entries(statuses)) {
      expect(mapApaleoReservation(parse({ status: apaleo })).status).toBe(internal);
    }
  });

  it("rejects payloads without the required fields or with pure dates", () => {
    expect(
      apaleoReservationSchema.safeParse(apaleoReservationPayload({ property: undefined })).success,
    ).toBe(false);
    expect(
      apaleoReservationSchema.safeParse(apaleoReservationPayload({ status: "Unknown" })).success,
    ).toBe(false);
    expect(
      apaleoReservationSchema.safeParse(apaleoReservationPayload({ arrival: "2026-08-27" }))
        .success,
    ).toBe(false);
  });
});
