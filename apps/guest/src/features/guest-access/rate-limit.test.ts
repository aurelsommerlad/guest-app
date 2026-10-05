import { describe, expect, it } from "vitest";

import { clientAddressFrom } from "./rate-limit";
import { safeErrorFields } from "./safe-error";

describe("clientAddressFrom", () => {
  it("prefers x-real-ip, then the first x-forwarded-for entry", () => {
    expect(clientAddressFrom(new Headers({ "x-real-ip": "203.0.113.1" }))).toBe("203.0.113.1");
    expect(clientAddressFrom(new Headers({ "x-forwarded-for": "203.0.113.2, 10.0.0.1" }))).toBe(
      "203.0.113.2",
    );
    expect(clientAddressFrom(new Headers())).toBe("unknown");
  });
});

describe("safeErrorFields", () => {
  it("keeps name and code but never the message (may contain query parameters)", () => {
    const error = new Error('Failed query: select … params: "ABCDEFGH-1"', {
      cause: Object.assign(new Error("duplicate key"), { code: "23505" }),
    });
    expect(safeErrorFields(error)).toEqual({ name: "Error", code: "23505" });
    expect(JSON.stringify(safeErrorFields(error))).not.toContain("ABCDEFGH");
    expect(safeErrorFields("nope")).toEqual({ name: "unknown" });
  });
});
