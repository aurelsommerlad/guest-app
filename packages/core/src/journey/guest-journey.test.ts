import { describe, expect, it } from "vitest";

import {
  deriveGuestJourney,
  deriveJourneyPhase,
  localDateOf,
  primaryActionFor,
} from "./guest-journey";

const window = {
  checkInAt: "2026-08-27T16:00:00+02:00",
  checkOutAt: "2026-08-31T10:00:00+02:00",
  timeZone: "Europe/Berlin",
};
const at = (iso: string) => new Date(iso);

describe("journey phase", () => {
  it("uses the property's local dates", () => {
    expect(deriveJourneyPhase(window, at("2026-08-26T23:59:00+02:00"))).toBe("before-arrival");
    expect(deriveJourneyPhase(window, at("2026-08-27T00:00:00+02:00"))).toBe("arrival-day");
    expect(deriveJourneyPhase(window, at("2026-08-27T18:00:00+02:00"))).toBe("arrival-day");
    expect(deriveJourneyPhase(window, at("2026-08-29T12:00:00+02:00"))).toBe("in-stay");
    expect(deriveJourneyPhase(window, at("2026-08-31T09:59:00+02:00"))).toBe("departure-day");
    expect(deriveJourneyPhase(window, at("2026-08-31T10:00:00+02:00"))).toBe("after-departure");
  });

  it("does not shift with the server's or guest's time zone", () => {
    // 23:30 UTC on the 26th is already the 27th in Berlin.
    expect(deriveJourneyPhase(window, at("2026-08-26T22:30:00Z"))).toBe("arrival-day");
    expect(localDateOf(at("2026-08-26T22:30:00Z"), "Europe/Vienna")).toBe("2026-08-27");
  });

  it("handles one-night and same-day stays", () => {
    const oneNight = { ...window, checkOutAt: "2026-08-28T10:00:00+02:00" };
    expect(deriveJourneyPhase(oneNight, at("2026-08-27T20:00:00+02:00"))).toBe("arrival-day");
    expect(deriveJourneyPhase(oneNight, at("2026-08-28T08:00:00+02:00"))).toBe("departure-day");
    const sameDay = { ...window, checkOutAt: "2026-08-27T20:00:00+02:00" };
    expect(deriveJourneyPhase(sameDay, at("2026-08-27T10:00:00+02:00"))).toBe("arrival-day");
    expect(deriveJourneyPhase(sameDay, at("2026-08-27T17:00:00+02:00"))).toBe("departure-day");
  });

  it("rejects invalid windows", () => {
    expect(() => deriveJourneyPhase({ ...window, checkInAt: "nope" }, new Date())).toThrow(
      RangeError,
    );
    expect(() =>
      deriveJourneyPhase({ ...window, checkOutAt: window.checkInAt }, new Date()),
    ).toThrow(RangeError);
  });
});

describe("primary action", () => {
  it("puts an open online check-in first until departure day", () => {
    expect(primaryActionFor("before-arrival", "not-started", "pending")).toBe("online-check-in");
    expect(primaryActionFor("arrival-day", "in-progress", "available")).toBe("online-check-in");
    expect(primaryActionFor("in-stay", "not-started", "available")).toBe("online-check-in");
    expect(primaryActionFor("departure-day", "not-started", "available")).toBe("check-out");
  });

  it("shows access once available and check-out on departure day", () => {
    expect(primaryActionFor("before-arrival", "completed", "pending")).toBe("check-in-info");
    expect(primaryActionFor("arrival-day", "completed", "available")).toBe("show-access");
    expect(primaryActionFor("arrival-day", "not-required", "pending")).toBe("check-in-info");
    expect(primaryActionFor("in-stay", "completed", "manual")).toBe("check-out");
    expect(primaryActionFor("departure-day", "completed", "available")).toBe("check-out");
    expect(primaryActionFor("after-departure", "not-started", "available")).toBe("none");
  });

  it("keeps time, registration and access as separate axes", () => {
    const journey = deriveGuestJourney({
      window,
      now: at("2026-08-27T12:00:00+02:00"),
      registration: "completed",
      access: "manual",
    });
    expect(journey).toEqual({
      phase: "arrival-day",
      registration: "completed",
      access: "manual",
      primaryAction: "check-in-info",
    });
  });
});
