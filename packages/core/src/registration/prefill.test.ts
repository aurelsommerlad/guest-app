import { describe, expect, it } from "vitest";

import { occupancyTotal, prefillGuests } from "./prefill";
import { type PropertyRegistrationConfig } from "./registration-model";

const config: PropertyRegistrationConfig = {
  enabled: true,
  country: "DE",
  targets: ["apaleo"],
  primaryGuest: {
    required: [
      "firstName",
      "lastName",
      "birthDate",
      "nationality",
      "street",
      "postalCode",
      "city",
      "country",
    ],
    optional: [],
  },
  companions: { required: ["firstName", "lastName", "birthDate", "nationality"], optional: [] },
  guestCardRelevant: false,
  providerSettings: {},
};
const today = "2026-08-01";

describe("prefill from the reservation", () => {
  it("prefills complete main guest data (case 1, 4, 8)", () => {
    const [laura] = prefillGuests(
      config,
      {
        guests: [
          {
            firstName: "Laura",
            lastName: "Muster",
            email: "Laura.Muster@example.com",
            phone: "0170 1234567",
            birthDate: "1990-05-17",
            nationality: "DE",
            street: "Seeweg 3",
            postalCode: "88131",
            city: "Lindau",
            country: "DE",
          },
        ],
      },
      1,
      today,
    );
    expect(laura).toEqual({
      position: 0,
      role: "primary",
      data: {
        firstName: "Laura",
        lastName: "Muster",
        email: "laura.muster@example.com",
        phone: "+491701234567",
        birthDate: "1990-05-17",
        nationality: "DE",
        street: "Seeweg 3",
        postalCode: "88131",
        city: "Lindau",
        country: "DE",
      },
      prefilledFields: [
        "firstName",
        "lastName",
        "email",
        "phone",
        "birthDate",
        "nationality",
        "street",
        "postalCode",
        "city",
        "country",
      ],
    });
  });

  it("never prefills a Booking.com relay e-mail (case 3)", () => {
    const [laura] = prefillGuests(
      config,
      { guests: [{ firstName: "Laura", lastName: "Muster", email: "example@guest.booking.com" }] },
      1,
      today,
    );
    expect(laura?.data).toEqual({ firstName: "Laura", lastName: "Muster" });
    expect(laura?.prefilledFields).not.toContain("email");
  });

  it("creates exactly the booked slots: known guests filled, unknown ones left empty (case 5–7)", () => {
    const pms = {
      occupancy: { adults: 2, children: 1, childrenAges: [8] },
      guests: [
        { firstName: "Laura", lastName: "Muster" },
        { firstName: "Tom", lastName: "Muster", birthDate: "1988-02-01" },
        { firstName: "Not", lastName: "Booked" },
      ],
    };
    expect(occupancyTotal(pms.occupancy)).toBe(3);
    const slots = prefillGuests(config, { ...pms, guests: pms.guests.slice(0, 2) }, 3, today);
    expect(slots.map((slot) => [slot.position, slot.data.firstName])).toEqual([
      [0, "Laura"],
      [1, "Tom"],
    ]);
    // More PMS guests than booked travellers: the extra one is ignored.
    expect(prefillGuests(config, pms, 1, today).map((slot) => slot.position)).toEqual([0]);
    expect(occupancyTotal({ adults: 0, children: 0 })).toBeUndefined();
  });

  it("drops implausible values and fields the property does not collect", () => {
    const [guest] = prefillGuests(
      config,
      {
        guests: [
          {
            firstName: "Laura",
            lastName: "Muster",
            birthDate: "17.05.1990",
            nationality: "Germany",
            phone: "0301234",
            documentNumber: "C01X00T47",
          },
        ],
      },
      1,
      today,
    );
    expect(guest?.data).toEqual({ firstName: "Laura", lastName: "Muster" });
  });
});
