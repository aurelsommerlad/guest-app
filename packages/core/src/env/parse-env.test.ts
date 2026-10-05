import { describe, expect, it } from "vitest";
import { z } from "zod";

import { appEnvironmentSchema } from "./app-environment";
import { EnvValidationError, parseEnv } from "./parse-env";

const schema = z.object({
  APP_ENV: appEnvironmentSchema,
  API_SECRET: z.string().min(8),
  PORT: z.coerce.number().default(3000),
});

describe("parseEnv", () => {
  it("returns typed, validated values", () => {
    const env = parseEnv(schema, { APP_ENV: "staging", API_SECRET: "supersecret" });
    expect(env).toEqual({ APP_ENV: "staging", API_SECRET: "supersecret", PORT: 3000 });
  });

  it("treats empty strings as missing", () => {
    expect(() => parseEnv(schema, { APP_ENV: "local", API_SECRET: "" })).toThrow(
      EnvValidationError,
    );
  });

  it("rejects unknown app environments", () => {
    expect(() => parseEnv(schema, { APP_ENV: "prod", API_SECRET: "supersecret" })).toThrow(
      /APP_ENV/,
    );
  });

  it("lists all invalid variables without leaking their values", () => {
    try {
      parseEnv(schema, { APP_ENV: "nope", API_SECRET: "short" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const { issues, message } = error as EnvValidationError;
      expect(issues).toHaveLength(2);
      expect(message).toContain("APP_ENV");
      expect(message).toContain("API_SECRET");
      expect(message).not.toContain("short");
      expect(message).not.toContain("nope");
    }
  });
});
