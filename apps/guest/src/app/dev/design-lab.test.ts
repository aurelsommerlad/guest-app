import { describe, expect, it } from "vitest";

import { isDesignLabEnabled } from "./design-lab";

describe("isDesignLabEnabled", () => {
  it("is available in local and staging", () => {
    expect(isDesignLabEnabled("local")).toBe(true);
    expect(isDesignLabEnabled("staging")).toBe(true);
  });

  it("is never available in production", () => {
    expect(isDesignLabEnabled("production")).toBe(false);
  });
});
