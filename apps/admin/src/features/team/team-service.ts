/**
 * Team management (M1-B): invite members, change role and property access, disable accounts.
 *
 * Every function authorizes on the server with the acting admin's role read on this request:
 * `users.manage` (owners and admins with access to all properties) plus `canAssignRole`
 * (only owners create or change owners). Data invariants (last owner, tenant properties)
 * are enforced again by the repository.
 */
import {
  ADMIN_ROLES,
  type AdminRole,
  canAssignRole,
  generateSecret,
  hashSecret,
  type Logger,
  PROPERTY_SCOPES,
  type PropertyScope,
} from "@up/core";
import {
  createAdminInvitation,
  type Database,
  getAdminUser,
  revokeAdminInvitation,
  setAdminUserStatus,
  updateAdminAccess,
} from "@up/db";

import { type AdminContext } from "../auth/admin-auth-service";
import { isAllowed, principalOf } from "../auth/authorization";

export const INVITATION_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

export type TeamDeps = { db: Database; logger: Logger; now: () => Date };

export type AccessInput = {
  role: string;
  propertyScope: string;
  propertyIds: readonly string[];
};

export type TeamResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const MESSAGES = {
  forbidden: "Dafür fehlt Dir die Berechtigung.",
  invalidRole: "Bitte wähle eine gültige Rolle.",
  invalidScope: "Bitte wähle mindestens ein Objekt oder „Alle Objekte“.",
  unknownProperty: "Mindestens ein gewähltes Objekt gibt es nicht.",
  lastOwner: "Es muss immer mindestens eine aktive Inhaberin bzw. einen aktiven Inhaber geben.",
  notFound: "Dieses Teammitglied gibt es nicht.",
  alreadyMember: "Für diese E-Mail-Adresse gibt es bereits ein Konto.",
  invalidEmail: "Bitte gib eine gültige E-Mail-Adresse an.",
  self: "Du kannst Dein eigenes Konto nicht deaktivieren.",
} as const;

function parseAccess(
  input: AccessInput,
):
  | { ok: true; role: AdminRole; propertyScope: PropertyScope; propertyIds: string[] }
  | { ok: false; error: string } {
  if (!(ADMIN_ROLES as readonly string[]).includes(input.role)) {
    return { ok: false, error: MESSAGES.invalidRole };
  }
  if (!(PROPERTY_SCOPES as readonly string[]).includes(input.propertyScope)) {
    return { ok: false, error: MESSAGES.invalidScope };
  }
  const role = input.role as AdminRole;
  const propertyScope = role === "owner" ? "all" : (input.propertyScope as PropertyScope);
  const propertyIds =
    propertyScope === "selected" ? [...new Set(input.propertyIds)].slice(0, 100) : [];
  if (propertyScope === "selected" && propertyIds.length === 0) {
    return { ok: false, error: MESSAGES.invalidScope };
  }
  return { ok: true, role, propertyScope, propertyIds };
}

/** Creates an invitation; the link (with the secret) is returned exactly once. */
export async function inviteMember(
  deps: TeamDeps,
  admin: AdminContext,
  input: AccessInput & { email: string },
): Promise<TeamResult<{ path: string; expiresAt: Date }>> {
  if (!isAllowed(admin, "users.manage")) return { ok: false, error: MESSAGES.forbidden };
  const access = parseAccess(input);
  if (!access.ok) return access;
  if (!canAssignRole(principalOf(admin), null, access.role)) {
    return { ok: false, error: MESSAGES.forbidden };
  }
  const now = deps.now();
  const token = generateSecret();
  const expiresAt = new Date(now.getTime() + INVITATION_VALIDITY_MS);
  const result = await createAdminInvitation(
    deps.db,
    { tenantId: admin.tenantId },
    {
      email: input.email,
      role: access.role,
      propertyScope: access.propertyScope,
      propertyIds: access.propertyIds,
      tokenHash: hashSecret(token),
      expiresAt,
      now,
      invitedBy: admin.adminUserId,
    },
  );
  if (!result.ok) {
    const error = {
      "already-member": MESSAGES.alreadyMember,
      "invalid-scope": MESSAGES.invalidScope,
      "unknown-property": MESSAGES.unknownProperty,
      "invalid-input": MESSAGES.invalidEmail,
    }[result.reason];
    return { ok: false, error };
  }
  deps.logger.info("admin invitation created", {
    adminUserId: admin.adminUserId,
    invitationId: result.invitation.id,
  });
  return { ok: true, path: `/invite/${token}`, expiresAt };
}

export async function changeMemberAccess(
  deps: TeamDeps,
  admin: AdminContext,
  targetUserId: string,
  input: AccessInput,
): Promise<TeamResult> {
  if (!isAllowed(admin, "users.manage")) return { ok: false, error: MESSAGES.forbidden };
  const access = parseAccess(input);
  if (!access.ok) return access;
  const context = { tenantId: admin.tenantId };
  const target = await getAdminUser(deps.db, context, targetUserId);
  if (!target) return { ok: false, error: MESSAGES.notFound };
  if (!canAssignRole(principalOf(admin), target.role, access.role)) {
    return { ok: false, error: MESSAGES.forbidden };
  }
  const result = await updateAdminAccess(deps.db, context, {
    actorAdminId: admin.adminUserId,
    targetUserId,
    role: access.role,
    propertyScope: access.propertyScope,
    propertyIds: access.propertyIds,
  });
  if (!result.ok) {
    const error = {
      "not-found": MESSAGES.notFound,
      "last-owner": MESSAGES.lastOwner,
      "invalid-scope": MESSAGES.invalidScope,
      "unknown-property": MESSAGES.unknownProperty,
    }[result.reason];
    return { ok: false, error };
  }
  return { ok: true };
}

export async function setMemberStatus(
  deps: TeamDeps,
  admin: AdminContext,
  targetUserId: string,
  status: "active" | "disabled",
): Promise<TeamResult> {
  if (!isAllowed(admin, "users.manage")) return { ok: false, error: MESSAGES.forbidden };
  const context = { tenantId: admin.tenantId };
  const target = await getAdminUser(deps.db, context, targetUserId);
  if (!target) return { ok: false, error: MESSAGES.notFound };
  // Admins never disable or re-enable owners.
  if (!canAssignRole(principalOf(admin), target.role, target.role)) {
    return { ok: false, error: MESSAGES.forbidden };
  }
  const result = await setAdminUserStatus(deps.db, context, {
    actorAdminId: admin.adminUserId,
    targetUserId,
    status,
    now: deps.now(),
  });
  if (!result.ok) {
    const error = {
      "not-found": MESSAGES.notFound,
      "last-owner": MESSAGES.lastOwner,
      self: MESSAGES.self,
    }[result.reason];
    return { ok: false, error };
  }
  return { ok: true };
}

export async function revokeInvitation(
  deps: TeamDeps,
  admin: AdminContext,
  invitationId: string,
): Promise<TeamResult> {
  if (!isAllowed(admin, "users.manage")) return { ok: false, error: MESSAGES.forbidden };
  const revoked = await revokeAdminInvitation(
    deps.db,
    { tenantId: admin.tenantId },
    { invitationId, actorAdminId: admin.adminUserId, now: deps.now() },
  );
  return revoked ? { ok: true } : { ok: false, error: MESSAGES.notFound };
}
