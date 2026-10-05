import { describe, expect, it } from "vitest";

import { isVisible, type VisibilityContext } from "./visibility";

const stay = { checkInAt: "2026-08-27T16:00:00+02:00", checkOutAt: "2026-08-31T10:00:00+02:00" };
const at = (iso: string, extra: Partial<VisibilityContext> = {}): VisibilityContext => ({
  now: new Date(iso),
  access: "reservation",
  stay,
  ...extra,
});

describe("isVisible", () => {
  it("shows content without visibility rules to guests with a reservation", () => {
    expect(isVisible(undefined, at("2026-08-29T12:00:00+02:00"))).toBe(true);
    expect(isVisible(undefined, at("2026-08-29T12:00:00+02:00", { access: "public" }))).toBe(false);
  });

  it("shows public content to everyone", () => {
    expect(
      isVisible({ audience: "public" }, at("2026-08-29T12:00:00+02:00", { access: "public" })),
    ).toBe(true);
  });

  it("supports absolute windows (from inclusive, until exclusive)", () => {
    const v = {
      from: { type: "absolute", at: "2026-08-01T00:00:00Z" },
      until: { type: "absolute", at: "2026-09-01T00:00:00Z" },
    } as const;
    expect(isVisible(v, at("2026-07-31T23:59:59Z"))).toBe(false);
    expect(isVisible(v, at("2026-08-01T00:00:00Z"))).toBe(true);
    expect(isVisible(v, at("2026-09-01T00:00:00Z"))).toBe(false);
  });

  it("supports times relative to check-in – e.g. a door code from 15:45", () => {
    const doorCode = {
      from: { type: "stay", anchor: "check-in", offsetMinutes: -15 },
      until: { type: "stay", anchor: "check-out" },
    } as const;
    expect(isVisible(doorCode, at("2026-08-27T15:44:00+02:00"))).toBe(false);
    expect(isVisible(doorCode, at("2026-08-27T15:45:00+02:00"))).toBe(true);
    expect(isVisible(doorCode, at("2026-08-31T10:00:00+02:00"))).toBe(false);
  });

  it("supports arrival information that disappears after check-in", () => {
    const beforeArrival = { until: { type: "stay", anchor: "check-in" } } as const;
    expect(isVisible(beforeArrival, at("2026-08-20T09:00:00+02:00"))).toBe(true);
    expect(isVisible(beforeArrival, at("2026-08-28T09:00:00+02:00"))).toBe(false);
  });

  it("never matches stay-relative rules without a known stay", () => {
    const v = { from: { type: "stay", anchor: "check-in" } } as const;
    expect(isVisible(v, at("2026-08-29T12:00:00+02:00", { stay: undefined }))).toBe(false);
  });
});
