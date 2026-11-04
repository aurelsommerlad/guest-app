import { createTestDatabase } from "@up/db/testing";
import { describe, expect, it } from "vitest";

import { databaseHealth } from "./database-health";

const REF = "abcdefghijklmnopqrst";
const URL = `postgresql://postgres.${REF}:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`;

describe("databaseHealth", () => {
  it("reports a missing configuration", async () => {
    expect(await databaseHealth(undefined, undefined)).toEqual({ status: "not-configured" });
  });

  it("reports the migration count and only a fingerprint of the project", async () => {
    const test = await createTestDatabase();
    try {
      const health = await databaseHealth(test.db, URL);
      expect(health.status).toBe("ok");
      expect(health.status === "ok" ? health.project : undefined).toMatch(/^[0-9a-f]{8}$/);
      expect(health.status === "ok" ? health.migrations : 0).toBeGreaterThan(0);
      expect(JSON.stringify(health)).not.toContain(REF);
      expect(JSON.stringify(health)).not.toContain("secret");
    } finally {
      await test.close();
    }
  });

  it("reports an unreachable database without details", async () => {
    const test = await createTestDatabase();
    await test.close();
    const health = await databaseHealth(test.db, URL);
    expect(health.status).toBe("unreachable");
  });
});
