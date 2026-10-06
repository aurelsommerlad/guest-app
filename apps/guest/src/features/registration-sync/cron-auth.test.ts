import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isAuthorizedCronRequest } from "./cron-auth";

const secret = "s".repeat(40);

describe("registration sync endpoint", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedCronRequest(`Bearer ${secret}`, secret)).toBe(true);
    expect(isAuthorizedCronRequest(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorizedCronRequest(secret, secret)).toBe(false);
    expect(isAuthorizedCronRequest(null, secret)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer ", undefined)).toBe(false);
  });
});

describe("guest texts", () => {
  it("never name providers or access systems", () => {
    for (const locale of ["de", "en"]) {
      const text = readFileSync(join(__dirname, "../../../messages", `${locale}.json`), "utf8");
      expect(text).not.toMatch(/apaleo|feratel|nuki|deskline|tesa|glutz|pindora/i);
    }
  });
});
