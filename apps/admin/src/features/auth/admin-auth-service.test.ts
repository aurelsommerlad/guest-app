import { createLogger, hashPassword } from "@up/core";
import { createAdminUser, type Database, seedTenant, uniquePlacesSeed } from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ADMIN_SESSION_MAX_AGE_MS,
  isSetupAvailable,
  loginAdmin,
  logoutAdmin,
  resolveAdminSession,
  setupFirstAdmin,
} from "./admin-auth-service";
import { adminCookieAttributes, adminCookieConfig } from "./session-cookie";

const NOW = new Date("2026-10-10T08:00:00Z");
const PASSWORD = "ein-langes-test-passwort";
const TOKEN = "setup-token-0123456789-0123456789-abcdef";

let test: TestDatabase;
let db: Database;
let lines: string[];
let clock: Date;
const deps = () => ({
  db,
  now: () => clock,
  logger: createLogger({ level: "debug", sink: (_level, line) => lines.push(line) }),
});

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  await seedTenant(db, uniquePlacesSeed);
  lines = [];
  clock = NOW;
});

afterEach(async () => {
  await test.close();
});

async function account(email = "redaktion@example.com") {
  return createAdminUser(
    db,
    { tenantId: "unique-places" },
    { email, passwordHash: await hashPassword(PASSWORD) },
  );
}

const login = (email: string, password: string, clientAddress = "203.0.113.5") =>
  loginAdmin(deps(), { email, password, clientAddress });

describe("admin login", () => {
  it("signs in with e-mail and password and resolves the tenant from the session", async () => {
    await account();
    const result = await login("Redaktion@Example.com", PASSWORD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.expiresAt.getTime()).toBe(NOW.getTime() + ADMIN_SESSION_MAX_AGE_MS);
    expect(await resolveAdminSession(deps(), result.session.secret)).toMatchObject({
      tenantId: "unique-places",
      email: "redaktion@example.com",
    });
  });

  it("answers unknown accounts, wrong passwords and disabled accounts identically", async () => {
    const user = await account();
    expect(await login("nobody@example.com", PASSWORD)).toEqual({ ok: false, reason: "invalid" });
    expect(await login("redaktion@example.com", "falsches-passwort-123")).toEqual({
      ok: false,
      reason: "invalid",
    });
    await db.execute(sql`UPDATE admin_users SET status = 'disabled' WHERE id = ${user.id}`);
    expect(await login("redaktion@example.com", PASSWORD)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("ends sessions on logout, expiry and when the account is disabled", async () => {
    const user = await account();
    const result = await login("redaktion@example.com", PASSWORD);
    if (!result.ok) throw new Error("login failed");
    clock = new Date(NOW.getTime() + ADMIN_SESSION_MAX_AGE_MS);
    expect(await resolveAdminSession(deps(), result.session.secret)).toBeUndefined();
    clock = NOW;
    await db.execute(sql`UPDATE admin_users SET status = 'disabled' WHERE id = ${user.id}`);
    expect(await resolveAdminSession(deps(), result.session.secret)).toBeUndefined();
    await db.execute(sql`UPDATE admin_users SET status = 'active' WHERE id = ${user.id}`);
    await logoutAdmin(deps(), result.session.secret);
    expect(await resolveAdminSession(deps(), result.session.secret)).toBeUndefined();
    expect(await resolveAdminSession(deps(), "garbage")).toBeUndefined();
  });

  it("rate-limits attempts per account and per client", async () => {
    await account();
    for (let i = 0; i < 5; i++)
      await login("redaktion@example.com", "falsch-falsch-falsch", `192.0.2.${i}`);
    expect(await login("redaktion@example.com", PASSWORD, "192.0.2.99")).toEqual({
      ok: false,
      reason: "rate-limited",
    });
  });

  it("never logs e-mails, passwords or session secrets", async () => {
    await account();
    const result = await login("redaktion@example.com", PASSWORD);
    await login("redaktion@example.com", "geheim-falsch-123");
    const log = lines.join("\n");
    expect(log).not.toMatch(/redaktion@example\.com|ein-langes-test-passwort|geheim-falsch/);
    if (result.ok) expect(log).not.toContain(result.session.secret);
  });

  it("uses a strict HttpOnly cookie, Secure with __Host- outside local", () => {
    expect(adminCookieConfig("production")).toEqual({
      name: "__Host-up_admin_session",
      secure: true,
    });
    expect(adminCookieAttributes(true, new Date(NOW.getTime() + 60_000), NOW)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 60,
    });
  });
});

describe("first admin setup", () => {
  const input = {
    setupToken: TOKEN,
    tenantSlug: "unique-places",
    email: "chef@example.com",
    password: PASSWORD,
    clientAddress: "x",
  };

  it("creates the first account with the right token – and only once", async () => {
    expect(await isSetupAvailable(deps(), TOKEN)).toBe(true);
    expect(await isSetupAvailable(deps(), undefined)).toBe(false);
    expect(await setupFirstAdmin(deps(), TOKEN, { ...input, setupToken: "wrong-token" })).toEqual({
      ok: false,
      reason: "invalid-token",
    });
    const result = await setupFirstAdmin(deps(), TOKEN, input);
    expect(result.ok).toBe(true);
    expect(await isSetupAvailable(deps(), TOKEN)).toBe(false);
    expect(
      await setupFirstAdmin(deps(), TOKEN, { ...input, email: "zweiter@example.com" }),
    ).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect((await login("chef@example.com", PASSWORD)).ok).toBe(true);
  });

  it("rejects unknown tenants, short passwords and a missing token configuration", async () => {
    expect(await setupFirstAdmin(deps(), undefined, input)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await setupFirstAdmin(deps(), TOKEN, { ...input, tenantSlug: "nobody" })).toEqual({
      ok: false,
      reason: "invalid-input",
    });
    expect(await setupFirstAdmin(deps(), TOKEN, { ...input, password: "kurz" })).toEqual({
      ok: false,
      reason: "invalid-input",
    });
  });
});
