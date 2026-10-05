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
      STAY_DATA_SOURCE: "mock",
      GUEST_ACCESS_MODE: "preview",
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

describe("STAY data source", () => {
  const staging = {
    APP_ENV: "staging",
    NEXT_PUBLIC_APP_URL: "https://staging.stay.unique-places.com",
  };
  const apaleo = {
    STAY_DATA_SOURCE: "apaleo",
    APALEO_CLIENT_ID: "client",
    APALEO_CLIENT_SECRET: "secret-value",
    APALEO_PREVIEW_RESERVATION_ID: "ABCDEFGH-1",
  };

  it("defaults to mock data without any Apaleo variables", () => {
    expect(validateServerEnv(staging).STAY_DATA_SOURCE).toBe("mock");
  });

  it("accepts apaleo mode with credentials and a preview reservation outside production", () => {
    expect(validateServerEnv({ ...staging, ...apaleo }).STAY_DATA_SOURCE).toBe("apaleo");
  });

  it("requires credentials and the preview reservation in apaleo mode", () => {
    expect(() => validateServerEnv({ ...staging, STAY_DATA_SOURCE: "apaleo" })).toThrow(
      /APALEO_CLIENT_ID[\s\S]*APALEO_CLIENT_SECRET[\s\S]*APALEO_PREVIEW_RESERVATION_ID/,
    );
  });

  it("never allows apaleo mode or a preview reservation in production", () => {
    const production = {
      APP_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://stay.unique-places.com",
    };
    expect(() => validateServerEnv({ ...production, ...apaleo })).toThrow(/STAY_DATA_SOURCE/);
    expect(() =>
      validateServerEnv({ ...production, APALEO_PREVIEW_RESERVATION_ID: "ABCDEFGH-1" }),
    ).toThrow(/APALEO_PREVIEW_RESERVATION_ID/);
  });

  it("does not echo secret values in validation errors", () => {
    let message = "";
    try {
      validateServerEnv({
        APP_ENV: "production",
        NEXT_PUBLIC_APP_URL: "https://stay.unique-places.com",
        ...apaleo,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("STAY_DATA_SOURCE");
    expect(message).not.toContain("secret-value");
  });
});

describe("DATABASE_URL", () => {
  const local = { APP_ENV: "local", NEXT_PUBLIC_APP_URL: "http://localhost:3000" };
  const production = {
    APP_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://stay.unique-places.com",
  };
  const supabase =
    "postgresql://postgres.project:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";

  it("is optional in every environment (the app does not read the database yet)", () => {
    expect(validateServerEnv(local).DATABASE_URL).toBeUndefined();
    expect(validateServerEnv(production).DATABASE_URL).toBeUndefined();
  });

  it("accepts postgres URLs", () => {
    expect(validateServerEnv({ ...production, DATABASE_URL: supabase }).DATABASE_URL).toBe(
      supabase,
    );
    expect(
      validateServerEnv({
        ...local,
        DATABASE_URL: "postgres://postgres:postgres@localhost:54322/postgres",
      }).DATABASE_URL,
    ).toBeDefined();
  });

  it("rejects other schemes without echoing the value", () => {
    const run = () => validateServerEnv({ ...local, DATABASE_URL: "mysql://user:secret@host/db" });
    expect(run).toThrow(/DATABASE_URL/);
    expect(run).not.toThrow(/secret/);
  });

  it("rejects localhost outside of local development", () => {
    expect(() =>
      validateServerEnv({
        ...production,
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/postgres",
      }),
    ).toThrow(/DATABASE_URL/);
  });
});

describe("GUEST_ACCESS_MODE", () => {
  const staging = {
    APP_ENV: "staging",
    NEXT_PUBLIC_APP_URL: "https://staging.stay.unique-places.com",
  };
  const production = {
    APP_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://stay.unique-places.com",
  };
  const database = {
    DATABASE_URL:
      "postgresql://postgres.ref:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
    GUEST_TENANT_SLUG: "unique-places",
  };

  it("defaults to preview", () => {
    expect(validateServerEnv(staging).GUEST_ACCESS_MODE).toBe("preview");
  });

  it("requires a database and a tenant in secured mode", () => {
    expect(() => validateServerEnv({ ...staging, GUEST_ACCESS_MODE: "secured" })).toThrow(
      /DATABASE_URL/,
    );
    expect(() =>
      validateServerEnv({
        ...staging,
        GUEST_ACCESS_MODE: "secured",
        DATABASE_URL: database.DATABASE_URL,
      }),
    ).toThrow(/GUEST_TENANT_SLUG/);
    expect(
      validateServerEnv({ ...staging, ...database, GUEST_ACCESS_MODE: "secured" })
        .GUEST_ACCESS_MODE,
    ).toBe("secured");
  });

  it("requires Apaleo credentials for secured mode in production", () => {
    expect(() =>
      validateServerEnv({ ...production, ...database, GUEST_ACCESS_MODE: "secured" }),
    ).toThrow(/APALEO_CLIENT_ID/);
    expect(
      validateServerEnv({
        ...production,
        ...database,
        GUEST_ACCESS_MODE: "secured",
        APALEO_CLIENT_ID: "id",
        APALEO_CLIENT_SECRET: "secret",
      }).GUEST_ACCESS_MODE,
    ).toBe("secured");
  });

  it("rejects malformed tenant slugs", () => {
    expect(() => validateServerEnv({ ...staging, GUEST_TENANT_SLUG: "Unique Places" })).toThrow(
      /GUEST_TENANT_SLUG/,
    );
  });
});
