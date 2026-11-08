/**
 * Admin users, roles, property access and invitations (Extras migration M1-B).
 *
 * The repository enforces the data invariants (last active owner, property ids of the own
 * tenant, valid principal shape, one open invitation per e-mail); WHO may change what is
 * decided by `can()` / `canAssignRole()` in the admin app before calling these functions.
 * Every change is written to the audit log in the same transaction.
 */
import {
  type AdminPrincipal,
  type AdminRole,
  isEntityKey,
  isSecretHash,
  isValidPrincipalShape,
  type PropertyScope,
  type TenantContext,
} from "@up/core";
import { and, asc, count, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";

import { type Database } from "../client";
import {
  adminInvitations,
  adminSessions,
  adminUserProperties,
  adminUsers,
  properties,
  type RECORD_SOURCES,
} from "../schema";
import { type AdminUser, listAdminUserPropertyIds, normalizeAdminEmail } from "./admin-repository";
import { recordAdminAuditEvent } from "./audit-repository";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

function assertTenantContext(context: TenantContext): void {
  if (!isEntityKey(context.tenantId)) throw new TypeError("Invalid tenant context");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Serializes owner-count checks per tenant (no two owners demote each other at once). */
async function lockTenantOwners(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`admin-owners:${tenantId}`}))`);
}

async function countOtherActiveOwners(
  tx: Tx,
  tenantId: string,
  exceptUserId: string,
): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(adminUsers)
    .where(
      and(
        eq(adminUsers.tenantId, tenantId),
        eq(adminUsers.role, "owner"),
        eq(adminUsers.status, "active"),
        ne(adminUsers.id, exceptUserId),
      ),
    );
  return row?.n ?? 0;
}

/** Property ids that exist in the tenant, deduplicated and sorted. */
async function tenantPropertyIds(
  tx: Tx | Database,
  tenantId: string,
  ids: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(ids)].filter((id) => isEntityKey(id));
  if (!unique.length) return [];
  const rows = await tx
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.tenantId, tenantId), inArray(properties.id, unique)));
  return rows.map((row) => row.id).sort();
}

/* ------------------------------------------------------------------------------------------
 * Users
 * ---------------------------------------------------------------------------------------- */

export type AdminUserListEntry = AdminUser & { lastLoginAt?: Date; createdAt: Date };

export async function listAdminUsers(
  db: Database,
  context: TenantContext,
): Promise<AdminUserListEntry[]> {
  assertTenantContext(context);
  const rows = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.tenantId, context.tenantId))
    .orderBy(asc(adminUsers.email));
  const assignments = await db
    .select()
    .from(adminUserProperties)
    .where(eq(adminUserProperties.tenantId, context.tenantId));
  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    ...(row.displayName ? { displayName: row.displayName } : {}),
    status: row.status,
    role: row.role,
    propertyScope: row.propertyScope,
    propertyIds:
      row.propertyScope === "selected"
        ? assignments
            .filter((a) => a.adminUserId === row.id)
            .map((a) => a.propertyId)
            .sort()
        : [],
    ...(row.lastLoginAt ? { lastLoginAt: row.lastLoginAt } : {}),
    createdAt: row.createdAt,
  }));
}

export async function getAdminUser(
  db: Database,
  context: TenantContext,
  adminUserId: string,
): Promise<AdminUser | undefined> {
  assertTenantContext(context);
  if (!UUID.test(adminUserId)) return undefined;
  const [row] = await db
    .select()
    .from(adminUsers)
    .where(and(eq(adminUsers.tenantId, context.tenantId), eq(adminUsers.id, adminUserId)));
  if (!row) return undefined;
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    ...(row.displayName ? { displayName: row.displayName } : {}),
    status: row.status,
    role: row.role,
    propertyScope: row.propertyScope,
    propertyIds:
      row.propertyScope === "selected" ? await listAdminUserPropertyIds(db, context, row.id) : [],
  };
}

export type AccessChangeResult =
  | { ok: true; user: AdminUser }
  | { ok: false; reason: "not-found" | "last-owner" | "invalid-scope" | "unknown-property" };

/**
 * Sets role and property access of an admin. Takes effect on the user's next request (the
 * role is read on every request); sessions stay valid unless the account is disabled.
 */
export async function updateAdminAccess(
  db: Database,
  context: TenantContext,
  input: {
    actorAdminId: string;
    targetUserId: string;
    role: AdminRole;
    propertyScope: PropertyScope;
    propertyIds: readonly string[];
  },
): Promise<AccessChangeResult> {
  assertTenantContext(context);
  if (!UUID.test(input.targetUserId)) return { ok: false, reason: "not-found" };
  return db.transaction(async (tx) => {
    await lockTenantOwners(tx, context.tenantId);
    const [current] = await tx
      .select()
      .from(adminUsers)
      .where(and(eq(adminUsers.tenantId, context.tenantId), eq(adminUsers.id, input.targetUserId)))
      .for("update");
    if (!current) return { ok: false, reason: "not-found" } as const;

    const scope: PropertyScope = input.role === "owner" ? "all" : input.propertyScope;
    const requested = scope === "selected" ? [...new Set(input.propertyIds)] : [];
    const propertyIds = await tenantPropertyIds(tx, context.tenantId, requested);
    if (propertyIds.length !== requested.length)
      return { ok: false, reason: "unknown-property" } as const;
    const principal: AdminPrincipal = { role: input.role, propertyScope: scope, propertyIds };
    if (!isValidPrincipalShape(principal)) return { ok: false, reason: "invalid-scope" } as const;

    if (current.role === "owner" && current.status === "active" && input.role !== "owner") {
      if ((await countOtherActiveOwners(tx, context.tenantId, current.id)) === 0) {
        return { ok: false, reason: "last-owner" } as const;
      }
    }

    const previousIds =
      current.propertyScope === "selected"
        ? (
            await tx
              .select({ id: adminUserProperties.propertyId })
              .from(adminUserProperties)
              .where(
                and(
                  eq(adminUserProperties.tenantId, context.tenantId),
                  eq(adminUserProperties.adminUserId, current.id),
                ),
              )
          )
            .map((r) => r.id)
            .sort()
        : [];

    await tx
      .update(adminUsers)
      .set({ role: input.role, propertyScope: scope })
      .where(and(eq(adminUsers.tenantId, context.tenantId), eq(adminUsers.id, current.id)));
    await tx
      .delete(adminUserProperties)
      .where(
        and(
          eq(adminUserProperties.tenantId, context.tenantId),
          eq(adminUserProperties.adminUserId, current.id),
        ),
      );
    if (propertyIds.length) {
      await tx.insert(adminUserProperties).values(
        propertyIds.map((propertyId) => ({
          tenantId: context.tenantId,
          adminUserId: current.id,
          propertyId,
        })),
      );
    }
    await recordAdminAuditEvent(tx, context, {
      actorType: "admin",
      actorAdminId: input.actorAdminId,
      action: "user.access_changed",
      entityType: "admin_user",
      entityId: current.id,
      details: {
        from: { role: current.role, scope: current.propertyScope, properties: previousIds },
        to: { role: input.role, scope, properties: propertyIds },
      },
    });
    return {
      ok: true,
      user: {
        id: current.id,
        tenantId: current.tenantId,
        email: current.email,
        ...(current.displayName ? { displayName: current.displayName } : {}),
        status: current.status,
        role: input.role,
        propertyScope: scope,
        propertyIds,
      },
    } as const;
  });
}

/**
 * Disables or re-enables an account. Disabling revokes every session at once (and the
 * session lookup already ignores disabled accounts), so access ends immediately.
 */
export async function setAdminUserStatus(
  db: Database,
  context: TenantContext,
  input: { actorAdminId: string; targetUserId: string; status: "active" | "disabled"; now: Date },
): Promise<
  { ok: true; revokedSessions: number } | { ok: false; reason: "not-found" | "last-owner" | "self" }
> {
  assertTenantContext(context);
  if (!UUID.test(input.targetUserId)) return { ok: false, reason: "not-found" };
  if (input.status === "disabled" && input.targetUserId === input.actorAdminId) {
    return { ok: false, reason: "self" };
  }
  return db.transaction(async (tx) => {
    await lockTenantOwners(tx, context.tenantId);
    const [current] = await tx
      .select()
      .from(adminUsers)
      .where(and(eq(adminUsers.tenantId, context.tenantId), eq(adminUsers.id, input.targetUserId)))
      .for("update");
    if (!current) return { ok: false, reason: "not-found" } as const;
    if (input.status === "disabled" && current.role === "owner" && current.status === "active") {
      if ((await countOtherActiveOwners(tx, context.tenantId, current.id)) === 0) {
        return { ok: false, reason: "last-owner" } as const;
      }
    }
    await tx
      .update(adminUsers)
      .set({ status: input.status })
      .where(and(eq(adminUsers.tenantId, context.tenantId), eq(adminUsers.id, current.id)));
    const revoked =
      input.status === "disabled"
        ? await tx
            .update(adminSessions)
            .set({ revokedAt: input.now })
            .where(
              and(
                eq(adminSessions.tenantId, context.tenantId),
                eq(adminSessions.adminUserId, current.id),
                isNull(adminSessions.revokedAt),
              ),
            )
            .returning({ id: adminSessions.id })
        : [];
    await recordAdminAuditEvent(tx, context, {
      actorType: "admin",
      actorAdminId: input.actorAdminId,
      action: input.status === "disabled" ? "user.disabled" : "user.enabled",
      entityType: "admin_user",
      entityId: current.id,
      details: { revokedSessions: revoked.length },
    });
    return { ok: true, revokedSessions: revoked.length } as const;
  });
}

/** Ends every live session of a user (e.g. "sign out everywhere", password change). */
export async function revokeAllAdminSessions(
  db: Database,
  context: TenantContext,
  adminUserId: string,
  now: Date,
): Promise<number> {
  assertTenantContext(context);
  if (!UUID.test(adminUserId)) return 0;
  const rows = await db
    .update(adminSessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(adminSessions.tenantId, context.tenantId),
        eq(adminSessions.adminUserId, adminUserId),
        isNull(adminSessions.revokedAt),
      ),
    )
    .returning({ id: adminSessions.id });
  return rows.length;
}

/**
 * Own password change: stores the new hash and ends every other live session of the user
 * (the current one, identified by its token hash, stays). Audited without any secret.
 */
export async function changeAdminPassword(
  db: Database,
  context: TenantContext,
  input: { adminUserId: string; passwordHash: string; keepTokenHash: string | null; now: Date },
): Promise<{ revokedSessions: number }> {
  assertTenantContext(context);
  if (!UUID.test(input.adminUserId)) throw new TypeError("Invalid admin user id");
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(adminUsers)
      .set({ passwordHash: input.passwordHash, updatedAt: input.now })
      .where(and(eq(adminUsers.tenantId, context.tenantId), eq(adminUsers.id, input.adminUserId)))
      .returning({ id: adminUsers.id });
    if (!updated.length) throw new Error("Admin user not found");
    const revoked = await tx
      .update(adminSessions)
      .set({ revokedAt: input.now })
      .where(
        and(
          eq(adminSessions.tenantId, context.tenantId),
          eq(adminSessions.adminUserId, input.adminUserId),
          isNull(adminSessions.revokedAt),
          ...(input.keepTokenHash ? [ne(adminSessions.tokenHash, input.keepTokenHash)] : []),
        ),
      )
      .returning({ id: adminSessions.id });
    await recordAdminAuditEvent(tx, context, {
      actorType: "admin",
      actorAdminId: input.adminUserId,
      action: "user.password_changed",
      entityType: "admin_user",
      entityId: input.adminUserId,
      details: { revokedSessions: revoked.length },
    });
    return { revokedSessions: revoked.length };
  });
}

/* ------------------------------------------------------------------------------------------
 * Invitations
 * ---------------------------------------------------------------------------------------- */

export type AdminInvitation = {
  id: string;
  tenantId: string;
  email: string;
  role: AdminRole;
  propertyScope: PropertyScope;
  propertyIds: string[];
  expiresAt: Date;
  acceptedAt?: Date;
  revokedAt?: Date;
  source: (typeof RECORD_SOURCES)[number];
  createdAt: Date;
};

function toInvitation(row: typeof adminInvitations.$inferSelect): AdminInvitation {
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    role: row.role,
    propertyScope: row.propertyScope,
    propertyIds: [...row.propertyIds],
    expiresAt: row.expiresAt,
    ...(row.acceptedAt ? { acceptedAt: row.acceptedAt } : {}),
    ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
    source: row.source,
    createdAt: row.createdAt,
  };
}

export type CreateInvitationResult =
  | { ok: true; invitation: AdminInvitation }
  | {
      ok: false;
      reason: "already-member" | "invalid-scope" | "unknown-property" | "invalid-input";
    };

/**
 * Creates an invitation (only the token hash is stored). An earlier open invitation for the
 * same e-mail is revoked, so exactly one link is valid.
 */
export async function createAdminInvitation(
  db: Database,
  context: TenantContext,
  input: {
    email: string;
    role: AdminRole;
    propertyScope: PropertyScope;
    propertyIds: readonly string[];
    tokenHash: string;
    expiresAt: Date;
    now: Date;
    invitedBy: string | null;
    source?: (typeof RECORD_SOURCES)[number];
  },
): Promise<CreateInvitationResult> {
  assertTenantContext(context);
  const email = normalizeAdminEmail(input.email);
  if (
    !isSecretHash(input.tokenHash) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254
  ) {
    return { ok: false, reason: "invalid-input" };
  }
  if (input.expiresAt <= input.now) return { ok: false, reason: "invalid-input" };
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.email, email));
    if (existing) return { ok: false, reason: "already-member" } as const;
    const scope: PropertyScope = input.role === "owner" ? "all" : input.propertyScope;
    const requested = scope === "selected" ? [...new Set(input.propertyIds)] : [];
    const propertyIds = await tenantPropertyIds(tx, context.tenantId, requested);
    if (propertyIds.length !== requested.length)
      return { ok: false, reason: "unknown-property" } as const;
    if (!isValidPrincipalShape({ role: input.role, propertyScope: scope, propertyIds })) {
      return { ok: false, reason: "invalid-scope" } as const;
    }
    await tx
      .update(adminInvitations)
      .set({ revokedAt: input.now })
      .where(
        and(
          eq(adminInvitations.tenantId, context.tenantId),
          eq(adminInvitations.email, email),
          isNull(adminInvitations.acceptedAt),
          isNull(adminInvitations.revokedAt),
        ),
      );
    const [row] = await tx
      .insert(adminInvitations)
      .values({
        tenantId: context.tenantId,
        email,
        role: input.role,
        propertyScope: scope,
        propertyIds,
        tokenHash: input.tokenHash,
        invitedBy: input.invitedBy,
        expiresAt: input.expiresAt,
        source: input.source ?? "stay",
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning();
    if (!row) throw new Error("Invitation was not created");
    await recordAdminAuditEvent(tx, context, {
      actorType: input.invitedBy ? "admin" : input.source === "extras" ? "import" : "system",
      actorAdminId: input.invitedBy,
      action: "user.invited",
      entityType: "admin_invitation",
      entityId: row.id,
      details: { role: input.role, scope, properties: propertyIds },
    });
    return { ok: true, invitation: toInvitation(row) } as const;
  });
}

export async function listAdminInvitations(
  db: Database,
  context: TenantContext,
): Promise<AdminInvitation[]> {
  assertTenantContext(context);
  const rows = await db
    .select()
    .from(adminInvitations)
    .where(eq(adminInvitations.tenantId, context.tenantId))
    .orderBy(asc(adminInvitations.createdAt));
  return rows.map(toInvitation);
}

/** Open, unexpired invitation by its token hash (no tenant context: the link determines it). */
export async function findOpenAdminInvitation(
  db: Database,
  tokenHash: string,
  now: Date,
): Promise<AdminInvitation | undefined> {
  if (!isSecretHash(tokenHash)) return undefined;
  const [row] = await db
    .select()
    .from(adminInvitations)
    .where(
      and(
        eq(adminInvitations.tokenHash, tokenHash),
        isNull(adminInvitations.acceptedAt),
        isNull(adminInvitations.revokedAt),
        gt(adminInvitations.expiresAt, now),
      ),
    );
  return row ? toInvitation(row) : undefined;
}

export async function revokeAdminInvitation(
  db: Database,
  context: TenantContext,
  input: { invitationId: string; actorAdminId: string; now: Date },
): Promise<boolean> {
  assertTenantContext(context);
  if (!UUID.test(input.invitationId)) return false;
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(adminInvitations)
      .set({ revokedAt: input.now })
      .where(
        and(
          eq(adminInvitations.tenantId, context.tenantId),
          eq(adminInvitations.id, input.invitationId),
          isNull(adminInvitations.acceptedAt),
          isNull(adminInvitations.revokedAt),
        ),
      )
      .returning({ id: adminInvitations.id });
    if (!rows.length) return false;
    await recordAdminAuditEvent(tx, context, {
      actorType: "admin",
      actorAdminId: input.actorAdminId,
      action: "user.invitation_revoked",
      entityType: "admin_invitation",
      entityId: input.invitationId,
    });
    return true;
  });
}

export type AcceptInvitationResult =
  { ok: true; user: AdminUser } | { ok: false; reason: "invalid" | "already-member" };

/**
 * Redeems an invitation: creates the account with the invited role and properties (only those
 * that still exist) and marks the invitation used – atomically, so a link works exactly once.
 */
export async function acceptAdminInvitation(
  db: Database,
  input: { tokenHash: string; passwordHash: string; displayName?: string; now: Date },
): Promise<AcceptInvitationResult> {
  if (!isSecretHash(input.tokenHash)) return { ok: false, reason: "invalid" };
  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(adminInvitations)
      .where(
        and(
          eq(adminInvitations.tokenHash, input.tokenHash),
          isNull(adminInvitations.acceptedAt),
          isNull(adminInvitations.revokedAt),
          gt(adminInvitations.expiresAt, input.now),
        ),
      )
      .for("update");
    if (!invitation) return { ok: false, reason: "invalid" } as const;
    const context = { tenantId: invitation.tenantId };
    const [existing] = await tx
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.email, invitation.email));
    if (existing) return { ok: false, reason: "already-member" } as const;
    const propertyIds =
      invitation.propertyScope === "selected"
        ? await tenantPropertyIds(tx, invitation.tenantId, invitation.propertyIds)
        : [];
    if (invitation.propertyScope === "selected" && !propertyIds.length) {
      return { ok: false, reason: "invalid" } as const;
    }
    const [user] = await tx
      .insert(adminUsers)
      .values({
        tenantId: invitation.tenantId,
        email: invitation.email,
        passwordHash: input.passwordHash,
        displayName: input.displayName?.trim() || null,
        role: invitation.role,
        propertyScope: invitation.propertyScope,
      })
      .returning();
    if (!user) throw new Error("Admin user was not created");
    if (propertyIds.length) {
      await tx.insert(adminUserProperties).values(
        propertyIds.map((propertyId) => ({
          tenantId: invitation.tenantId,
          adminUserId: user.id,
          propertyId,
        })),
      );
    }
    await tx
      .update(adminInvitations)
      .set({ acceptedAt: input.now, acceptedUserId: user.id })
      .where(eq(adminInvitations.id, invitation.id));
    await recordAdminAuditEvent(tx, context, {
      actorType: "admin",
      actorAdminId: user.id,
      action: "user.invitation_accepted",
      entityType: "admin_user",
      entityId: user.id,
      details: {
        invitation: invitation.id,
        role: invitation.role,
        scope: invitation.propertyScope,
      },
    });
    return {
      ok: true,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        ...(user.displayName ? { displayName: user.displayName } : {}),
        status: user.status,
        role: user.role,
        propertyScope: user.propertyScope,
        propertyIds,
      },
    } as const;
  });
}
