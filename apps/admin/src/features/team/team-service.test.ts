import { createLogger, hashPassword } from "@up/core";
import { createAdminUser, type Database, seedTenant, uniquePlacesSeed } from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acceptInvitation,
  type AdminContext,
  previewInvitation,
  resolveAdminSession,
} from "../auth/admin-auth-service";
import {
  changeMemberAccess,
  inviteMember,
  revokeInvitation,
  setMemberStatus,
} from "./team-service";

const NOW = new Date("2026-11-08T08:00:00Z");
const PASSWORD = "ein-langes-test-passwort";

let test: TestDatabase;
let db: Database;
let lines: string[];
const deps = () => ({
  db,
  now: () => NOW,
  logger: createLogger({ level: "debug", sink: (_level, line) => lines.push(line) }),
});

async function member(
  email: string,
  role: AdminContext["role"],
  scope: Pick<AdminContext, "propertyScope" | "propertyIds"> = {
    propertyScope: "all",
    propertyIds: [],
  },
): Promise<AdminContext> {
  const user = await createAdminUser(
    db,
    { tenantId: "unique-places" },
    { email, passwordHash: await hashPassword(PASSWORD), role },
  );
  return { adminUserId: user.id, tenantId: user.tenantId, email: user.email, role, ...scope };
}

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  await seedTenant(db, uniquePlacesSeed);
  lines = [];
});

afterEach(async () => {
  await test.close();
});

const tokenOf = (path: string) => path.replace("/invite/", "");

describe("invitations", () => {
  it("invites a property-limited manager who sets a password and is signed in with that scope", async () => {
    const owner = await member("owner@example.com", "owner");
    const invited = await inviteMember(deps(), owner, {
      email: "neu@example.com",
      role: "manager",
      propertyScope: "selected",
      propertyIds: ["hov"],
    });
    expect(invited).toMatchObject({ ok: true });
    if (!invited.ok) return;
    const token = tokenOf(invited.path);
    expect(await previewInvitation(deps(), token)).toMatchObject({
      role: "manager",
      email: "neu@example.com",
    });

    const accepted = await acceptInvitation(deps(), {
      token,
      password: PASSWORD,
      clientAddress: "203.0.113.9",
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(await resolveAdminSession(deps(), accepted.session.secret)).toMatchObject({
      email: "neu@example.com",
      role: "manager",
      propertyScope: "selected",
      propertyIds: ["hov"],
    });
    // The link works once.
    expect(
      await acceptInvitation(deps(), { token, password: PASSWORD, clientAddress: "203.0.113.9" }),
    ).toEqual({
      ok: false,
      reason: "invalid",
    });
    // Neither the secret nor the e-mail address is logged.
    expect(lines.join("\n")).not.toContain(token);
    expect(lines.join("\n")).not.toContain("neu@example.com");
  });

  it("rejects short passwords without using up the link", async () => {
    const owner = await member("owner@example.com", "owner");
    const invited = await inviteMember(deps(), owner, {
      email: "x@example.com",
      role: "viewer",
      propertyScope: "all",
      propertyIds: [],
    });
    if (!invited.ok) throw new Error("expected invitation");
    const token = tokenOf(invited.path);
    expect(
      await acceptInvitation(deps(), { token, password: "kurz", clientAddress: "203.0.113.9" }),
    ).toEqual({
      ok: false,
      reason: "invalid-password",
    });
    expect(await previewInvitation(deps(), token)).toBeDefined();
  });

  it("admins invite admins, managers and viewers – never owners; managers and viewers invite nobody", async () => {
    const admin = await member("admin@example.com", "admin");
    const manager = await member("manager@example.com", "manager");
    const base = { propertyScope: "all", propertyIds: [] };
    expect(
      (await inviteMember(deps(), admin, { ...base, email: "a@example.com", role: "admin" })).ok,
    ).toBe(true);
    expect(
      await inviteMember(deps(), admin, { ...base, email: "o@example.com", role: "owner" }),
    ).toEqual({
      ok: false,
      error: "Dafür fehlt Dir die Berechtigung.",
    });
    expect(
      (await inviteMember(deps(), manager, { ...base, email: "m@example.com", role: "viewer" })).ok,
    ).toBe(false);
  });

  it("a property-limited admin cannot manage users (tenant-wide permission)", async () => {
    const limited = await member("limited@example.com", "admin", {
      propertyScope: "selected",
      propertyIds: ["hov"],
    });
    expect(
      (
        await inviteMember(deps(), limited, {
          email: "v@example.com",
          role: "viewer",
          propertyScope: "selected",
          propertyIds: ["hov"],
        })
      ).ok,
    ).toBe(false);
  });

  it("revoked invitations stop working", async () => {
    const owner = await member("owner@example.com", "owner");
    const invited = await inviteMember(deps(), owner, {
      email: "r@example.com",
      role: "viewer",
      propertyScope: "all",
      propertyIds: [],
    });
    if (!invited.ok) throw new Error("expected invitation");
    const rows = await test.client.query<{ id: string }>(`SELECT id FROM admin_invitations`);
    expect((await revokeInvitation(deps(), owner, rows.rows[0]?.id ?? "")).ok).toBe(true);
    expect(await previewInvitation(deps(), tokenOf(invited.path))).toBeUndefined();
  });
});

describe("role changes and revocation", () => {
  it("applies a role change on the member's very next request", async () => {
    const owner = await member("owner@example.com", "owner");
    const invited = await inviteMember(deps(), owner, {
      email: "m@example.com",
      role: "manager",
      propertyScope: "all",
      propertyIds: [],
    });
    if (!invited.ok) throw new Error("expected invitation");
    const accepted = await acceptInvitation(deps(), {
      token: tokenOf(invited.path),
      password: PASSWORD,
      clientAddress: "203.0.113.9",
    });
    if (!accepted.ok) throw new Error("expected account");
    const session = await resolveAdminSession(deps(), accepted.session.secret);
    expect(session?.role).toBe("manager");

    expect(
      (
        await changeMemberAccess(deps(), owner, session?.adminUserId ?? "", {
          role: "viewer",
          propertyScope: "selected",
          propertyIds: ["laeke"],
        })
      ).ok,
    ).toBe(true);
    expect(await resolveAdminSession(deps(), accepted.session.secret)).toMatchObject({
      role: "viewer",
      propertyScope: "selected",
      propertyIds: ["laeke"],
    });

    expect((await setMemberStatus(deps(), owner, session?.adminUserId ?? "", "disabled")).ok).toBe(
      true,
    );
    expect(await resolveAdminSession(deps(), accepted.session.secret)).toBeUndefined();
  });

  it("admins never change or disable owners; nobody demotes the last owner", async () => {
    const owner = await member("owner@example.com", "owner");
    const admin = await member("admin@example.com", "admin");
    const all = { propertyScope: "all", propertyIds: [] };
    expect(
      (await changeMemberAccess(deps(), admin, owner.adminUserId, { ...all, role: "viewer" })).ok,
    ).toBe(false);
    expect((await setMemberStatus(deps(), admin, owner.adminUserId, "disabled")).ok).toBe(false);
    expect(
      (await changeMemberAccess(deps(), admin, admin.adminUserId, { ...all, role: "owner" })).ok,
    ).toBe(false);
    expect(
      await changeMemberAccess(deps(), owner, owner.adminUserId, { ...all, role: "admin" }),
    ).toEqual({
      ok: false,
      error: "Es muss immer mindestens eine aktive Inhaberin bzw. einen aktiven Inhaber geben.",
    });
  });

  it("viewers and managers cannot change anyone", async () => {
    const viewer = await member("viewer@example.com", "viewer");
    const manager = await member("manager@example.com", "manager");
    const target = await member("target@example.com", "viewer");
    const all = { propertyScope: "all", propertyIds: [] };
    for (const actor of [viewer, manager]) {
      expect(
        (await changeMemberAccess(deps(), actor, target.adminUserId, { ...all, role: "manager" }))
          .ok,
      ).toBe(false);
      expect((await setMemberStatus(deps(), actor, target.adminUserId, "disabled")).ok).toBe(false);
    }
  });
});
