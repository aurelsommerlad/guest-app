import { createLogger, type PropertyRegistrationConfig } from "@up/core";

import { findPropertyById } from "../../config/properties";
import { type GuestContext } from "../guest-context/guest-context";

/** Test configuration only – real required fields are confirmed per property (ADR 0016). */
export const testRegistrationConfig: PropertyRegistrationConfig = {
  enabled: true,
  country: "DE",
  targets: ["apaleo", "feratel"],
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
  children: { underAge: 16, required: ["firstName", "lastName", "birthDate"], optional: [] },
  guestCardRelevant: false,
  providerSettings: {},
  retentionDaysAfterDeparture: 90,
};

export const BEFORE_ARRIVAL = new Date("2026-08-20T10:00:00+02:00");

export function capturingLogger() {
  const lines: string[] = [];
  return {
    logger: createLogger({ level: "debug", sink: (_level, line) => lines.push(line) }),
    lines,
  };
}

export function guestContext(
  overrides: Partial<GuestContext> & {
    guestCount?: { adults: number; children: number } | null;
  } = {},
): GuestContext {
  const property = findPropertyById("hov");
  if (!property) throw new Error("hov missing");
  const { guestCount, ...rest } = overrides;
  return {
    mode: "guest",
    tenantId: "unique-places",
    propertyId: "hov",
    unitId: "ros",
    reservationProvider: "apaleo",
    externalReservationId: "ABCDEFGH-1",
    guestAccessId: "22222222-2222-4222-8222-222222222222",
    property,
    now: BEFORE_ARRIVAL,
    reservation: {
      status: "loaded",
      source: {
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
          status: "confirmed",
          checkInAt: "2026-08-27T16:00:00+02:00",
          checkOutAt: "2026-08-31T10:00:00+02:00",
          ...(guestCount === null ? {} : { guestCount: guestCount ?? { adults: 2, children: 0 } }),
        },
        cards: [],
      },
    },
    ...rest,
  };
}
