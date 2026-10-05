import { describe, expect, it } from "vitest";

import { validateServerEnv } from "./schema";

const base = { APP_ENV: "staging", NEXT_PUBLIC_APP_URL: "https://admin-staging.unique-places.com" };

describe("admin env", () => {
  it("accepts a minimal configuration with defaults", () => {
    expect(validateServerEnv(base)).toMatchObject({
      GUIDE_MEDIA_BUCKET: "guide-media",
      LOG_LEVEL: "info",
    });
  });

  it("requires Supabase URL and key together, https and a long setup token", () => {
    expect(() => validateServerEnv({ ...base, SUPABASE_URL: "https://abc.supabase.co" })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
    expect(() =>
      validateServerEnv({
        ...base,
        SUPABASE_URL: "http://abc.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "x".repeat(40),
      }),
    ).toThrow(/SUPABASE_URL/);
    expect(() => validateServerEnv({ ...base, ADMIN_SETUP_TOKEN: "short" })).toThrow(
      /ADMIN_SETUP_TOKEN/,
    );
  });

  it("rejects http and localhost databases outside local", () => {
    expect(() =>
      validateServerEnv({ ...base, NEXT_PUBLIC_APP_URL: "http://admin.example.com" }),
    ).toThrow();
    expect(() =>
      validateServerEnv({
        ...base,
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/postgres",
      }),
    ).toThrow(/DATABASE_URL/);
  });
});
