import { EnvValidationError } from "@up/core";
import { describe, expect, it } from "vitest";

import { validateServerEnv } from "./schema";

describe("validateServerEnv", () => {
  it("accepts a valid local configuration and applies defaults", () => {
    expect(
      validateServerEnv({ APP_ENV: "local", NEXT_PUBLIC_APP_URL: "http://localhost:3000" }),
    ).toEqual({
      APP_ENV: "local",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      LOG_LEVEL: "info",
    });
  });

  it("accepts https for staging and production", () => {
    for (const APP_ENV of ["staging", "production"]) {
      expect(
        validateServerEnv({ APP_ENV, NEXT_PUBLIC_APP_URL: "https://stay.unique-places.com" })
          .APP_ENV,
      ).toBe(APP_ENV);
    }
  });

  it("requires https outside of local", () => {
    expect(() =>
      validateServerEnv({
        APP_ENV: "production",
        NEXT_PUBLIC_APP_URL: "http://stay.unique-places.com",
      }),
    ).toThrow(/https/);
  });

  it("requires APP_ENV", () => {
    expect(() => validateServerEnv({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toThrow(
      EnvValidationError,
    );
  });

  it("rejects invalid log levels", () => {
    expect(() =>
      validateServerEnv({
        APP_ENV: "local",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        LOG_LEVEL: "verbose",
      }),
    ).toThrow(/LOG_LEVEL/);
  });
});
