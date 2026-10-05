import { describe, expect, it } from "vitest";

import { deriveStayPhase } from "./stay-phase";

const window = { checkInAt: "2026-08-27T15:00:00+02:00", checkOutAt: "2026-08-31T10:00:00+02:00" };

describe("deriveStayPhase", () => {
  it("is pre-arrival before check-in", () => {
    expect(deriveStayPhase(window, new Date("2026-08-27T14:59:00+02:00"))).toBe("pre-arrival");
  });

  it("is in-house from check-in until check-out", () => {
    expect(deriveStayPhase(window, new Date("2026-08-27T15:00:00+02:00"))).toBe("in-house");
    expect(deriveStayPhase(window, new Date("2026-08-31T09:59:00+02:00"))).toBe("in-house");
  });

  it("is post-departure from the check-out time", () => {
    expect(deriveStayPhase(window, new Date("2026-08-31T10:00:00+02:00"))).toBe("post-departure");
  });

  it("compares instants, independent of the server time zone", () => {
    // 07:59 UTC = 09:59 Europe/Berlin (summer time) → still in-house
    expect(deriveStayPhase(window, new Date("2026-08-31T07:59:00Z"))).toBe("in-house");
  });

  it("rejects invalid windows", () => {
    expect(() => deriveStayPhase({ checkInAt: "x", checkOutAt: "y" }, new Date())).toThrow(
      RangeError,
    );
    expect(() =>
      deriveStayPhase({ checkInAt: window.checkOutAt, checkOutAt: window.checkInAt }, new Date()),
    ).toThrow(/after check-in/);
  });
});
