import { describe, expect, it } from "vitest";

import { testRegistrationConfig } from "./test-context";
import { nextStepsAfterCheckIn } from "./next-steps";

const window = {
  checkInAt: "2026-08-27T16:00:00+02:00",
  checkOutAt: "2026-08-31T10:00:00+02:00",
  timeZone: "Europe/Berlin",
};
const format = { time: (iso: string) => `T(${iso})`, date: (iso: string) => `D(${iso})` };
const journey = (overrides: Record<string, unknown> = {}) =>
  ({
    journey: {
      phase: "before-arrival",
      registration: "completed",
      access: "pending",
      primaryAction: "check-in-info",
    },
    access: {
      status: "pending",
      reason: "not-yet-released",
      releasesAt: "2026-08-26T22:00:00.000Z",
    },
    window,
    settings: {
      registration: { ...testRegistrationConfig, targets: ["apaleo"] },
      access: { mode: "keybox", release: "arrival-day", requiresCompletedRegistration: false },
      configured: true,
    },
    syncs: [],
    ...overrides,
  }) as Parameters<typeof nextStepsAfterCheckIn>[0];

describe("what happens next", () => {
  it("lists check-in time and access day – nothing about a registration the property does not do", () => {
    expect(nextStepsAfterCheckIn(journey(), format).map((step) => step.key)).toEqual([
      "nextCheckIn",
      "nextAccessDay",
    ]);
  });

  it("names the release time when access opens at check-in time", () => {
    const steps = nextStepsAfterCheckIn(
      journey({
        access: {
          status: "pending",
          reason: "not-yet-released",
          releasesAt: "2026-08-27T14:00:00.000Z",
        },
      }),
      format,
    );
    expect(steps[1]).toMatchObject({
      key: "nextAccessTime",
      values: { time: "T(2026-08-27T14:00:00.000Z)" },
    });
  });

  it("says 'prepared' until the official registration really synced", () => {
    const withFeratel = {
      settings: {
        registration: { ...testRegistrationConfig, targets: ["apaleo", "feratel"] },
        access: { mode: "manual", release: "arrival-day", requiresCompletedRegistration: false },
        configured: true,
      },
    };
    expect(nextStepsAfterCheckIn(journey(withFeratel), format).at(-1)?.key).toBe(
      "nextGuestRegistrationPending",
    );
    expect(
      nextStepsAfterCheckIn(
        journey({ ...withFeratel, syncs: [{ provider: "feratel", status: "failed" }] }),
        format,
      ).at(-1)?.key,
    ).toBe("nextGuestRegistrationPending");
    expect(
      nextStepsAfterCheckIn(
        journey({ ...withFeratel, syncs: [{ provider: "feratel", status: "synced" }] }),
        format,
      ).at(-1)?.key,
    ).toBe("nextGuestRegistrationSubmitted");
  });

  it("points to the home screen once access is released, and drops the check-in line during the stay", () => {
    const steps = nextStepsAfterCheckIn(
      journey({
        journey: {
          phase: "in-stay",
          registration: "completed",
          access: "manual",
          primaryAction: "check-out",
        },
        access: { status: "manual" },
      }),
      format,
    );
    expect(steps.map((step) => step.key)).toEqual(["nextAccessNow"]);
  });
});
