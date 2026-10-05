import { describe, expect, it } from "vitest";

import { type StaySource } from "./model";
import { buildStayViewModel } from "./build-stay-view-model";

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
    checkInAt: "2026-08-27T15:00:00+02:00",
    checkOutAt: "2026-08-31T10:00:00+02:00",
    onlineCheckIn: { status: "open", stepsRemaining: 2 },
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

  it("asks for the online check-in before arrival while it is open", () => {
    const model = buildStayViewModel(source, "de", new Date("2026-08-20T09:00:00+02:00"));
    expect(model.phase).toBe("pre-arrival");
    expect(model.status).toEqual({ kind: "online-check-in", stepsRemaining: 2, href: "/check-in" });
  });

  it("falls back to the check-out tile once the check-in is completed", () => {
    const completed = {
      ...source,
      reservation: {
        ...source.reservation,
        onlineCheckIn: { status: "completed" as const, stepsRemaining: 0 },
      },
    };
    const model = buildStayViewModel(completed, "de", new Date("2026-08-20T09:00:00+02:00"));
    expect(model.status.kind).toBe("check-out");
  });

  it("resolves translated card content with fallback to German", () => {
    const [card] = buildStayViewModel(source, "en", inHouse).cards;
    expect(card).toMatchObject({
      title: "Discover the Allgäu",
      subtitle: "Unsere Lieblingsplätze für Dich",
    });
    expect(card?.image.alt).toBe("Berge");
  });

  it("keeps branded property names untouched", () => {
    const model = buildStayViewModel(source, "de", inHouse);
    expect(model.property).toEqual({ name: "HØV", spokenName: "Höv", location: "Altusried" });
  });
});
