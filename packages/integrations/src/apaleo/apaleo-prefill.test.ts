import { describe, expect, it } from "vitest";

import { createApaleoProvider } from "./apaleo-provider";
import {
  capturingLogger,
  CLIENT_ID,
  CLIENT_SECRET,
  jsonResponse,
  scriptedFetch,
  tokenResponse,
} from "./test-helpers";

function provider(payload: unknown) {
  const { fetchFn, calls } = scriptedFetch([() => tokenResponse(), () => jsonResponse(payload)]);
  const { logger, lines } = capturingLogger();
  return {
    pms: createApaleoProvider({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      logger,
      fetch: fetchFn,
      retryDelayMs: 0,
    }),
    calls,
    lines,
  };
}

const reservation = {
  id: "ABCDEFGH-1",
  status: "Confirmed",
  adults: 2,
  childrenAges: [8],
  primaryGuest: {
    title: "Ms",
    firstName: " Laura ",
    lastName: "Muster",
    email: "4h7k2m9@guest.booking.com",
    phone: "+49 170 1234567",
    birthDate: "1990-05-17T00:00:00Z",
    nationalityCountryCode: "DE",
    address: {
      addressLine1: "Seeweg 3",
      addressLine2: "c/o",
      postalCode: "88131",
      city: "Lindau",
      countryCode: "DE",
    },
    company: { name: "Beispiel GmbH" },
    preferredLanguage: "de",
  },
  additionalGuests: [
    {
      firstName: "Tom",
      lastName: "Muster",
      birthDate: "1988-02-01",
      identificationType: "PassportNumber",
    },
  ],
  booker: { firstName: "Agentur", lastName: "X", email: "booker@example.com" },
  totalGrossAmount: { amount: 840, currency: "EUR" },
};

describe("ApaleoProvider.getReservationGuests", () => {
  it("reads occupancy and guests from the same verified endpoint", async () => {
    const { pms, calls } = provider(reservation);
    const result = await pms.getReservationGuests("ABCDEFGH-1");
    expect(calls[1]?.url).toBe("https://api.apaleo.com/booking/v1/reservations/ABCDEFGH-1");
    expect(result.occupancy).toEqual({ adults: 2, children: 1, childrenAges: [8] });
    expect(result.guests).toEqual([
      {
        firstName: "Laura",
        lastName: "Muster",
        // Raw here – the relay filter is applied centrally in @up/core when prefilling.
        email: "4h7k2m9@guest.booking.com",
        phone: "+49 170 1234567",
        birthDate: "1990-05-17",
        nationality: "DE",
        street: "Seeweg 3",
        postalCode: "88131",
        city: "Lindau",
        country: "DE",
      },
      // An identification type without a number is not a document.
      { firstName: "Tom", lastName: "Muster", birthDate: "1988-02-01" },
    ]);
  });

  it("uses neither booker nor unrelated profile data and logs no guest data", async () => {
    const { pms, lines } = provider(reservation);
    const serialized = JSON.stringify(await pms.getReservationGuests("ABCDEFGH-1"));
    for (const value of ["Agentur", "booker@example.com", "Beispiel GmbH", "c/o", "840"]) {
      expect(serialized).not.toContain(value);
    }
    const log = lines.join("\n");
    for (const value of ["Laura", "Muster", "guest.booking.com", "1234567"])
      expect(log).not.toContain(value);
  });

  it("handles reservations with only a primary guest or none", async () => {
    const { pms } = provider({ id: "ABCDEFGH-2", status: "Confirmed", adults: 1 });
    expect(await pms.getReservationGuests("ABCDEFGH-2")).toEqual({
      occupancy: { adults: 1, children: 0 },
      guests: [{}],
    });
  });
});
