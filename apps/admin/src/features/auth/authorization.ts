/**
 * Authorization of admin actions (M1): one rule for every server action and page –
 * `can()` from @up/core with the role and property access read from the database on this
 * request. Never decided in the browser; hiding a button is only convenience.
 */
import { type AdminPermission, type AdminPrincipal, can, canAccessProperty } from "@up/core";

import { type AdminContext } from "./admin-auth-service";

export function principalOf(admin: AdminContext): AdminPrincipal {
  return { role: admin.role, propertyScope: admin.propertyScope, propertyIds: admin.propertyIds };
}

export function isAllowed(
  admin: AdminContext,
  permission: AdminPermission,
  target: { propertyId?: string } = {},
): boolean {
  return can(principalOf(admin), permission, target);
}

/** Properties visible to the admin (for lists, the selector and tenant-wide reads). */
export function visibleProperties<T extends { id: string }>(
  admin: AdminContext,
  list: readonly T[],
): T[] {
  const principal = principalOf(admin);
  return list.filter((item) => canAccessProperty(principal, item.id));
}

export const FORBIDDEN_MESSAGE = "Dafür fehlt Dir die Berechtigung.";
