import { createLogger, hashPassword } from "@up/core";
import {
  createAdminUser,
  type Database,
  listAdminAuditEvents,
  seedTenant,
  uniquePlacesSeed,
} from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loginAdmin, resolveAdminSession } from "../auth/admin-auth-service";
import { changeOwnPassword } from "./account-service";

const OLD = "altes-passwort-123";
const NEW = "neues-passwort-456";
let test: TestDatabase;
let db: Database;
const lines: string[] = [];
const deps = () => ({
  db,
  now: () => new Date("2026-11-08T10:00:00Z"),
  logger: createLogger({ level: "debug", sink: (_l, line) => lines.push(line) }),
});

beforeAll(async () => {
  test = await createTestDatabase();
  db = test.db;
  await seedTenant(db, uniquePlacesSeed);
  await createAdminUser(
    db,
    { tenantId: "unique-places" },
    { email: "konto@example.test", passwordHash: await hashPassword(OLD) },
  );
});
afterAll(async () => {
  await test.close();
});

async function session() {
  const result = await loginAdmin(deps(), {
    email: "konto@example.test",
    password: OLD,
    clientAddress: `198.51.100.${String(Math.floor(Math.random() * 200))}`,
  });
  if (!result.ok) throw new Error("login failed");
  return result.session.secret;
}

describe("own password change", () => {
  it("validates current password, length, confirmation and difference", async () => {
    const secret = await session();
    const admin = await resolveAdminSession(deps(), secret);
    if (!admin) throw new Error("no session");
    const change = (current: string, next: string, confirm = next) =>
      changeOwnPassword(deps(), admin, { current, next, confirm }, secret);
    expect(await change("falsch-falsch-1", NEW)).toEqual({
      ok: false,
      error: "Das aktuelle Passwort ist nicht korrekt.",
    });
    expect((await change(OLD, "kurz")).ok).toBe(false);
    expect(await change(OLD, NEW, `${NEW}x`)).toEqual({
      ok: false,
      error: "Die beiden neuen Passwörter stimmen nicht überein.",
    });
    expect(await change(OLD, OLD)).toEqual({
      ok: false,
      error: "Das neue Passwort muss sich vom bisherigen unterscheiden.",
    });
  });

  it("stores the new hash, keeps the current session, ends the others and audits", async () => {
    const other = await session();
    const current = await session();
    const admin = await resolveAdminSession(deps(), current);
    if (!admin) throw new Error("no session");
    const result = await changeOwnPassword(deps(), admin, { current: OLD, next: NEW, confirm: NEW }, current);
    expect(result.ok && result.revokedSessions).toBeGreaterThanOrEqual(1);
    expect(await resolveAdminSession(deps(), current)).toBeDefined();
    expect(await resolveAdminSession(deps(), other)).toBeUndefined();
    const relogin = await loginAdmin(deps(), { email: "konto@example.test", password: NEW, clientAddress: "198.51.100.250" });
    expect(relogin.ok).toBe(true);
    const audit = await listAdminAuditEvents(db, { tenantId: "unique-places" });
    expect(audit.map((e) => e.action)).toContain("user.password_changed");
    expect(lines.join("\n")).not.toContain(NEW);
    expect(lines.join("\n")).not.toContain(OLD);
  });

  it("rate-limits repeated attempts", async () => {
    const secret = await loginAdmin(deps(), { email: "konto@example.test", password: NEW, clientAddress: "198.51.100.251" });
    if (!secret.ok) throw new Error("login failed");
    const admin = await resolveAdminSession(deps(), secret.session.secret);
    if (!admin) throw new Error("no session");
    let last;
    for (let i = 0; i < 6; i++)
      last = await changeOwnPassword(deps(), admin, { current: "falsch-falsch-1", next: "x".repeat(12), confirm: "x".repeat(12) }, secret.session.secret);
    expect(last).toEqual({ ok: false, error: "Zu viele Versuche. Bitte versuche es in 15 Minuten erneut." });
  });
});
