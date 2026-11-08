import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database } from "../client";
import { seedTenant } from "../seed/seed-tenant";
import { uniquePlacesSeed } from "../seed/unique-places";
import {
  createTestDatabase,
  expectConstraintViolation,
  type TestDatabase,
} from "../testing/test-database";
import {
  acceptAdminInvitation,
  createAdminInvitation,
  findOpenAdminInvitation,
  getAdminUser,
  listAdminInvitations,
  listAdminUsers,
  revokeAdminInvitation,
  setAdminUserStatus,
  updateAdminAccess,
} from "./admin-access-repository";
import {
  createAdminSession,
  createAdminUser,
  findAdminSessionByTokenHash,
} from "./admin-repository";
import { listAdminAuditEvents } from "./audit-repository";

const up = { tenantId: "unique-places" };
const other = { tenantId: "other-tenant" };
const HASH = "scrypt$test";
const now = new Date("2026-11-08T10:00:00Z");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

let db: Database;
let client: TestDatabase["client"];
let close: () => Promise<void>;
let ownerId: string;

beforeAll(async () => {
  ({ db, client, close } = await createTestDatabase());
  await seedTenant(db, uniquePlacesSeed);
  await client.query(
    `INSERT INTO tenants (id, slug, name) VALUES ('other-tenant', 'other-tenant', 'Other')`,
  );
  await client.query(
    `INSERT INTO properties (id, tenant_id, slug, display_name, spoken_name, location_name, timezone)
     VALUES ('elsewhere', 'other-tenant', 'elsewhere', 'Elsewhere', 'Elsewhere', 'X', 'Europe/Berlin')`,
  );
  ownerId = (
    await createAdminUser(db, up, {
      email: "owner@example.test",
      passwordHash: HASH,
      role: "owner",
    })
  ).id;
});

afterAll(async () => {
  await close();
});

describe("accounts and roles", () => {
  it("creates accounts as viewers unless a role is given (least privilege)", async () => {
    const user = await createAdminUser(db, up, { email: "plain@example.test", passwordHash: HASH });
    expect(user).toMatchObject({ role: "viewer", propertyScope: "all", propertyIds: [] });
  });

  it("limits a manager to selected properties and the session reflects it on the next request", async () => {
    const manager = await createAdminUser(db, up, {
      email: "manager@example.test",
      passwordHash: HASH,
      role: "manager",
    });
    const tokenHash = sha("manager-session");
    await createAdminSession(db, up, {
      adminUserId: manager.id,
      tokenHash,
      expiresAt: new Date(now.getTime() + 3600_000),
    });

    const result = await updateAdminAccess(db, up, {
      actorAdminId: ownerId,
      targetUserId: manager.id,
      role: "manager",
      propertyScope: "selected",
      propertyIds: ["hov", "huesle", "hov"],
    });
    expect(result).toMatchObject({
      ok: true,
      user: { propertyScope: "selected", propertyIds: ["hov", "huesle"] },
    });
    const session = await findAdminSessionByTokenHash(db, tokenHash, now);
    expect(session?.user).toMatchObject({
      role: "manager",
      propertyScope: "selected",
      propertyIds: ["hov", "huesle"],
    });

    // Revoking a property takes effect immediately (no re-login).
    await updateAdminAccess(db, up, {
      actorAdminId: ownerId,
      targetUserId: manager.id,
      role: "viewer",
      propertyScope: "selected",
      propertyIds: ["hov"],
    });
    expect((await findAdminSessionByTokenHash(db, tokenHash, now))?.user).toMatchObject({
      role: "viewer",
      propertyIds: ["hov"],
    });
  });

  it("rejects properties of another tenant and empty selections", async () => {
    const user = await createAdminUser(db, up, {
      email: "scoped@example.test",
      passwordHash: HASH,
      role: "manager",
    });
    expect(
      await updateAdminAccess(db, up, {
        actorAdminId: ownerId,
        targetUserId: user.id,
        role: "manager",
        propertyScope: "selected",
        propertyIds: ["elsewhere"],
      }),
    ).toEqual({ ok: false, reason: "unknown-property" });
    expect(
      await updateAdminAccess(db, up, {
        actorAdminId: ownerId,
        targetUserId: user.id,
        role: "manager",
        propertyScope: "selected",
        propertyIds: [],
      }),
    ).toEqual({ ok: false, reason: "invalid-scope" });
  });

  it("never sees or changes users of another tenant", async () => {
    const foreign = await createAdminUser(db, other, {
      email: "foreign@example.test",
      passwordHash: HASH,
      role: "owner",
    });
    expect(await getAdminUser(db, up, foreign.id)).toBeUndefined();
    expect((await listAdminUsers(db, up)).some((u) => u.id === foreign.id)).toBe(false);
    expect(
      await updateAdminAccess(db, up, {
        actorAdminId: ownerId,
        targetUserId: foreign.id,
        role: "viewer",
        propertyScope: "all",
        propertyIds: [],
      }),
    ).toEqual({ ok: false, reason: "not-found" });
  });

  it("owners always have every property (database check)", async () => {
    await expectConstraintViolation(
      client.query(`UPDATE admin_users SET property_scope = 'selected' WHERE id = $1`, [ownerId]),
      "admin_users_owner_all_properties",
    );
  });

  it("protects the last active owner against demotion and disabling", async () => {
    expect(
      await updateAdminAccess(db, up, {
        actorAdminId: ownerId,
        targetUserId: ownerId,
        role: "admin",
        propertyScope: "all",
        propertyIds: [],
      }),
    ).toEqual({ ok: false, reason: "last-owner" });
    const second = await createAdminUser(db, up, {
      email: "owner2@example.test",
      passwordHash: HASH,
      role: "owner",
    });
    expect(
      await setAdminUserStatus(db, up, {
        actorAdminId: second.id,
        targetUserId: ownerId,
        status: "disabled",
        now,
      }),
    ).toMatchObject({
      ok: true,
    });
    expect(
      await setAdminUserStatus(db, up, {
        actorAdminId: ownerId,
        targetUserId: second.id,
        status: "disabled",
        now,
      }),
    ).toEqual({
      ok: false,
      reason: "last-owner",
    });
    await setAdminUserStatus(db, up, {
      actorAdminId: second.id,
      targetUserId: ownerId,
      status: "active",
      now,
    });
  });

  it("disabling revokes every session at once and nobody disables themselves", async () => {
    const admin = await createAdminUser(db, up, {
      email: "admin@example.test",
      passwordHash: HASH,
      role: "admin",
    });
    const hashes = [sha("a1"), sha("a2")];
    for (const tokenHash of hashes) {
      await createAdminSession(db, up, {
        adminUserId: admin.id,
        tokenHash,
        expiresAt: new Date(now.getTime() + 3600_000),
      });
    }
    expect(
      await setAdminUserStatus(db, up, {
        actorAdminId: admin.id,
        targetUserId: admin.id,
        status: "disabled",
        now,
      }),
    ).toEqual({
      ok: false,
      reason: "self",
    });
    expect(
      await setAdminUserStatus(db, up, {
        actorAdminId: ownerId,
        targetUserId: admin.id,
        status: "disabled",
        now,
      }),
    ).toEqual({
      ok: true,
      revokedSessions: 2,
    });
    for (const tokenHash of hashes)
      expect(await findAdminSessionByTokenHash(db, tokenHash, now)).toBeUndefined();
    // Re-enabling does not resurrect old sessions.
    await setAdminUserStatus(db, up, {
      actorAdminId: ownerId,
      targetUserId: admin.id,
      status: "active",
      now,
    });
    expect(await findAdminSessionByTokenHash(db, hashes[0] as string, now)).toBeUndefined();
  });

  it("audits every access change without e-mail addresses", async () => {
    const events = await listAdminAuditEvents(db, up);
    expect(events.some((e) => e.action === "user.access_changed")).toBe(true);
    expect(events.some((e) => e.action === "user.disabled")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("@example.test");
  });
});

describe("invitations", () => {
  it("creates an invitation with only the token hash and accepts it exactly once", async () => {
    const tokenHash = sha("invite-1");
    const created = await createAdminInvitation(db, up, {
      email: "New.Person@Example.test",
      role: "manager",
      propertyScope: "selected",
      propertyIds: ["laeke"],
      tokenHash,
      expiresAt: new Date(now.getTime() + 7 * 86400_000),
      now,
      invitedBy: ownerId,
    });
    expect(created).toMatchObject({
      ok: true,
      invitation: { email: "new.person@example.test", propertyIds: ["laeke"] },
    });
    expect((await findOpenAdminInvitation(db, tokenHash, now))?.role).toBe("manager");

    const [first, second] = await Promise.all([
      acceptAdminInvitation(db, { tokenHash, passwordHash: HASH, now }),
      acceptAdminInvitation(db, { tokenHash, passwordHash: HASH, now }),
    ]);
    const results = [first, second];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const accepted = results.find((r) => r.ok);
    expect(accepted).toMatchObject({
      user: { role: "manager", propertyScope: "selected", propertyIds: ["laeke"] },
    });
    expect(await findOpenAdminInvitation(db, tokenHash, now)).toBeUndefined();
  });

  it("rejects expired, revoked and unknown links", async () => {
    const expired = sha("invite-expired");
    await createAdminInvitation(db, up, {
      email: "late@example.test",
      role: "viewer",
      propertyScope: "all",
      propertyIds: [],
      tokenHash: expired,
      expiresAt: new Date(now.getTime() + 1000),
      now,
      invitedBy: ownerId,
    });
    expect(
      await acceptAdminInvitation(db, {
        tokenHash: expired,
        passwordHash: HASH,
        now: new Date(now.getTime() + 2000),
      }),
    ).toEqual({
      ok: false,
      reason: "invalid",
    });

    const revoked = sha("invite-revoked");
    const created = await createAdminInvitation(db, up, {
      email: "revoked@example.test",
      role: "viewer",
      propertyScope: "all",
      propertyIds: [],
      tokenHash: revoked,
      expiresAt: new Date(now.getTime() + 86400_000),
      now,
      invitedBy: ownerId,
    });
    if (!created.ok) throw new Error("expected invitation");
    expect(
      await revokeAdminInvitation(db, other, {
        invitationId: created.invitation.id,
        actorAdminId: ownerId,
        now,
      }),
    ).toBe(false);
    expect(
      await revokeAdminInvitation(db, up, {
        invitationId: created.invitation.id,
        actorAdminId: ownerId,
        now,
      }),
    ).toBe(true);
    expect(
      await acceptAdminInvitation(db, { tokenHash: revoked, passwordHash: HASH, now }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      await acceptAdminInvitation(db, { tokenHash: sha("nope"), passwordHash: HASH, now }),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("re-inviting replaces the open link; existing members cannot be invited", async () => {
    const base = {
      role: "viewer" as const,
      propertyScope: "all" as const,
      propertyIds: [],
      now,
      invitedBy: ownerId,
    };
    const expiresAt = new Date(now.getTime() + 86400_000);
    await createAdminInvitation(db, up, {
      ...base,
      email: "twice@example.test",
      tokenHash: sha("t1"),
      expiresAt,
    });
    await createAdminInvitation(db, up, {
      ...base,
      email: "twice@example.test",
      tokenHash: sha("t2"),
      expiresAt,
    });
    expect(await findOpenAdminInvitation(db, sha("t1"), now)).toBeUndefined();
    expect(await findOpenAdminInvitation(db, sha("t2"), now)).toBeDefined();
    expect(
      await createAdminInvitation(db, up, {
        ...base,
        email: "owner@example.test",
        tokenHash: sha("t3"),
        expiresAt,
      }),
    ).toEqual({
      ok: false,
      reason: "already-member",
    });
    expect(
      await createAdminInvitation(db, up, {
        ...base,
        role: "owner",
        propertyScope: "selected",
        propertyIds: ["hov"],
        email: "o@example.test",
        tokenHash: sha("t4"),
        expiresAt,
      }),
    ).toMatchObject({ ok: true, invitation: { propertyScope: "all", propertyIds: [] } });
    expect((await listAdminInvitations(db, other)).length).toBe(0);
  });
});
