/**
 * Admin accounts and sessions (ADR 0014). Lookups by e-mail and by session hash are the
 * only reads without a TenantContext – they are how the tenant is determined at login.
 */
import {
  type AdminRole,
  isEntityKey,
  isSecretHash,
  type PropertyScope,
  type TenantContext,
} from "@up/core";
import { and, asc, count, eq, gt, isNull } from "drizzle-orm";

import { type Database } from "../client";
import { adminSessions, adminUserProperties, adminUsers } from "../schema";

export type AdminUser = {
  id: string;
  tenantId: string;
  email: string;
  displayName?: string;
  status: "active" | "disabled";
  /** Role and property access (M1) – read from the database on every request. */
  role: AdminRole;
  propertyScope: PropertyScope;
  /** Only filled for propertyScope "selected". */
  propertyIds: string[];
};

/** Property ids of an admin with a selected scope (empty for scope "all"). */
export async function listAdminUserPropertyIds(
  db: Database,
  context: TenantContext,
  adminUserId: string,
): Promise<string[]> {
  const rows = await db
    .select({ propertyId: adminUserProperties.propertyId })
    .from(adminUserProperties)
    .where(
      and(
        eq(adminUserProperties.tenantId, context.tenantId),
        eq(adminUserProperties.adminUserId, adminUserId),
      ),
    )
    .orderBy(asc(adminUserProperties.propertyId));
  return rows.map((row) => row.propertyId);
}

async function propertyIdsFor(
  db: Database,
  user: { tenantId: string; id: string; propertyScope: PropertyScope },
): Promise<string[]> {
  return user.propertyScope === "selected"
    ? listAdminUserPropertyIds(db, { tenantId: user.tenantId }, user.id)
    : [];
}

export type AdminUserWithHash = AdminUser & { passwordHash: string };

/** Login names are case-insensitive and stored lowercased. */
export function normalizeAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertTenantContext(context: TenantContext): void {
  if (!isEntityKey(context.tenantId)) throw new TypeError("Invalid tenant context");
}

export async function findAdminUserByEmail(
  db: Database,
  email: string,
): Promise<AdminUserWithHash | undefined> {
  const normalized = normalizeAdminEmail(email);
  if (normalized.length < 3 || normalized.length > 254) return undefined;
  const [row] = await db.select().from(adminUsers).where(eq(adminUsers.email, normalized));
  if (!row) return undefined;
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    ...(row.displayName ? { displayName: row.displayName } : {}),
    status: row.status,
    role: row.role,
    propertyScope: row.propertyScope,
    propertyIds: await propertyIdsFor(db, row),
    passwordHash: row.passwordHash,
  };
}

export async function countAdminUsers(db: Database): Promise<number> {
  const [row] = await db.select({ n: count() }).from(adminUsers);
  return row?.n ?? 0;
}

export async function createAdminUser(
  db: Database,
  context: TenantContext,
  input: {
    email: string;
    passwordHash: string;
    displayName?: string;
    /** Explicit role; accounts created without one are viewers (least privilege). */
    role?: AdminRole;
  },
): Promise<AdminUser> {
  assertTenantContext(context);
  const [row] = await db
    .insert(adminUsers)
    .values({
      tenantId: context.tenantId,
      email: normalizeAdminEmail(input.email),
      passwordHash: input.passwordHash,
      displayName: input.displayName ?? null,
      role: input.role ?? "viewer",
      propertyScope: "all",
    })
    .returning();
  if (!row) throw new Error("Admin user was not created");
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    ...(row.displayName ? { displayName: row.displayName } : {}),
    status: row.status,
    role: row.role,
    propertyScope: row.propertyScope,
    propertyIds: [],
  };
}

export async function recordAdminLogin(
  db: Database,
  context: TenantContext,
  adminUserId: string,
  now: Date,
): Promise<void> {
  assertTenantContext(context);
  await db
    .update(adminUsers)
    .set({ lastLoginAt: now })
    .where(and(eq(adminUsers.tenantId, context.tenantId), eq(adminUsers.id, adminUserId)));
}

export async function createAdminSession(
  db: Database,
  context: TenantContext,
  input: { adminUserId: string; tokenHash: string; expiresAt: Date },
): Promise<void> {
  assertTenantContext(context);
  if (!isSecretHash(input.tokenHash)) throw new TypeError("Expected a SHA-256 hex hash");
  await db.insert(adminSessions).values({ ...input, tenantId: context.tenantId });
}

/** A live session of an active admin user. */
export async function findAdminSessionByTokenHash(
  db: Database,
  tokenHash: string,
  now: Date,
): Promise<{ sessionId: string; expiresAt: Date; user: AdminUser } | undefined> {
  if (!isSecretHash(tokenHash)) return undefined;
  const [row] = await db
    .select({
      sessionId: adminSessions.id,
      expiresAt: adminSessions.expiresAt,
      id: adminUsers.id,
      tenantId: adminUsers.tenantId,
      email: adminUsers.email,
      displayName: adminUsers.displayName,
      status: adminUsers.status,
      role: adminUsers.role,
      propertyScope: adminUsers.propertyScope,
    })
    .from(adminSessions)
    .innerJoin(
      adminUsers,
      and(
        eq(adminUsers.tenantId, adminSessions.tenantId),
        eq(adminUsers.id, adminSessions.adminUserId),
      ),
    )
    .where(
      and(
        eq(adminSessions.tokenHash, tokenHash),
        isNull(adminSessions.revokedAt),
        gt(adminSessions.expiresAt, now),
        eq(adminUsers.status, "active"),
      ),
    );
  if (!row) return undefined;
  const { sessionId, expiresAt, displayName, ...user } = row;
  const propertyIds = await propertyIdsFor(db, user);
  return {
    sessionId,
    expiresAt,
    user: { ...user, propertyIds, ...(displayName ? { displayName } : {}) },
  };
}

export async function revokeAdminSession(
  db: Database,
  tokenHash: string,
  now: Date,
): Promise<void> {
  if (!isSecretHash(tokenHash)) return;
  await db
    .update(adminSessions)
    .set({ revokedAt: now })
    .where(and(eq(adminSessions.tokenHash, tokenHash), isNull(adminSessions.revokedAt)));
}
