import { describe, expect, it } from "vitest";

import { type StaySource } from "./model";
import { deriveGuestJourney, type RegistrationProgress, type StayAccess } from "@up/core";

import { buildStayViewModel, type StayJourneyInput } from "./build-stay-view-model";

const source: StaySource = {
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
    checkInAt: "2026-08-27T15:00:00+02:00",
    checkOutAt: "2026-08-31T10:00:00+02:00",
  },
  cards: [
    {
      id: "explore",
      href: "/explore",
      title: { de: "Allgäu entdecken", en: "Discover the Allgäu" },
      subtitle: { de: "Unsere Lieblingsplätze für Dich" },
      image: { src: "/photo.webp", alt: { de: "Berge" } },
    },
  ],
};

const inHouse = new Date("2026-08-29T12:00:00+02:00");

describe("buildStayViewModel", () => {
  it("shows the check-out in the property's time zone during the stay", () => {
    const model = buildStayViewModel(source, "de", inHouse);
    expect(model.phase).toBe("in-house");
    expect(model.status).toEqual({
      kind: "check-out",
      today: false,
      time: "10:00",
      date: "31. August 2026",
      dateTime: "2026-08-31T10:00:00+02:00",
    });
  });

  it("formats per locale", () => {
    const model = buildStayViewModel(source, "en", inHouse);
    expect(model.status).toMatchObject({ kind: "check-out", date: "August 31, 2026" });
    expect(model.status.kind === "check-out" && model.status.time).toMatch(/^10:00\sAM$/);
  });

  it("resolves translated card content with fallback to German", () => {
    const [card] = buildStayViewModel(source, "en", inHouse).cards;
    expect(card).toMatchObject({
      title: "Discover the Allgäu",
      subtitle: "Unsere Lieblingsplätze für Dich",
    });
    expect(card?.image.alt).toBe("Berge");
  });

  it("omits the first name when the PMS has none", () => {
    expect(buildStayViewModel({ ...source, guest: {} }, "de", inHouse).guest).toEqual({});
  });

  it("shows the check-out tile without journey data (database unavailable)", () => {
    const model = buildStayViewModel(source, "de", new Date("2026-08-20T09:00:00+02:00"));
    expect(model.status.kind).toBe("check-out");
    expect(model.access).toBeUndefined();
  });

  it("keeps branded property names untouched", () => {
    const model = buildStayViewModel(source, "de", inHouse);
    expect(model.property).toEqual({ name: "HØV", spokenName: "Höv", location: "Altusried" });
  });
});

function journeyAt(
  now: Date,
  registration: RegistrationProgress,
  access: StayAccess,
  stepsRemaining = 3,
): StayJourneyInput {
  return {
    journey: deriveGuestJourney({
      window: { ...source.reservation, timeZone: "Europe/Berlin" },
      now,
      registration,
      access: access.status,
    }),
    assessment: { stepsRemaining },
    access,
  };
}

const notReleased: StayAccess = {
  status: "pending",
  reason: "not-yet-released",
  releasesAt: "2026-08-26T22:00:00.000Z",
};
const keybox: StayAccess = {
  status: "available",
  credential: {
    type: "keybox",
    validFrom: "2026-08-27T15:00:00+02:00",
    validUntil: "2026-08-31T10:00:00+02:00",
  },
};

describe("STAY with guest journey", () => {
  it("puts an open online check-in first before arrival (started or not)", () => {
    const before = new Date("2026-08-20T09:00:00+02:00");
    const model = buildStayViewModel(
      source,
      "de",
      before,
      journeyAt(before, "not-started", notReleased),
    );
    expect(model.status).toEqual({
      kind: "online-check-in",
      stepsRemaining: 3,
      href: "/check-in",
      started: false,
    });
    expect(model.access).toBeUndefined();
    const resumed = buildStayViewModel(
      source,
      "de",
      before,
      journeyAt(before, "in-progress", notReleased, 1),
    );
    expect(resumed.status).toMatchObject({ started: true, stepsRemaining: 1 });
  });

  it("shows the check-in time once registered and access on the arrival day", () => {
    const before = new Date("2026-08-20T09:00:00+02:00");
    expect(
      buildStayViewModel(source, "de", before, journeyAt(before, "completed", notReleased)).status,
    ).toMatchObject({ kind: "check-in", time: "15:00", date: "27. August 2026" });
    const arrival = new Date("2026-08-27T11:00:00+02:00");
    const model = buildStayViewModel(
      source,
      "de",
      arrival,
      journeyAt(arrival, "completed", keybox),
    );
    expect(model.journeyPhase).toBe("arrival-day");
    expect(model.status.kind).toBe("check-in");
    expect(model.access).toEqual({
      kind: "available",
      credentialType: "keybox",
      validFrom: { time: "15:00", date: "27. August 2026", dateTime: "2026-08-27T15:00:00+02:00" },
    });
    // The view model never contains a code.
    expect(JSON.stringify(model)).not.toMatch(/displayValue/);
  });

  it("explains a blocked access and makes the check-out visible on departure day", () => {
    const arrival = new Date("2026-08-27T18:00:00+02:00");
    const blocked = buildStayViewModel(
      source,
      "de",
      arrival,
      journeyAt(arrival, "not-started", { status: "pending", reason: "registration-required" }),
    );
    expect(blocked.access).toEqual({ kind: "registration-required", href: "/check-in" });
    const departure = new Date("2026-08-31T08:00:00+02:00");
    const model = buildStayViewModel(
      source,
      "de",
      departure,
      journeyAt(departure, "completed", keybox),
    );
    expect(model.status).toMatchObject({ kind: "check-out", today: true, time: "10:00" });
    expect(model.access?.kind).toBe("available");
  });

  it("shows manual instructions in the guest's language", () => {
    const stay = new Date("2026-08-29T12:00:00+02:00");
    const model = buildStayViewModel(
      source,
      "en",
      stay,
      journeyAt(stay, "not-required", {
        status: "manual",
        instructions: { de: "Schlüssel an der Rezeption", en: "Key at the front desk" },
      }),
    );
    expect(model.access).toEqual({ kind: "manual", instructions: "Key at the front desk" });
    expect(model.status).toMatchObject({ kind: "check-out", today: false });
  });
});
