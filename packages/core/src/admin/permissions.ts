/**
 * Admin roles and permissions (Extras migration M1, decided 2026-11-08).
 *
 * - Four roles: owner, admin, manager, viewer.
 * - Access can be limited to selected properties (owners always see every property).
 * - Every server-side admin action asks `can()` with the permission and, for property-bound
 *   actions, the property. The role is read from the database on every request, so changes
 *   take effect immediately.
 */

export const ADMIN_ROLES = ["owner", "admin", "manager", "viewer"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const PROPERTY_SCOPES = ["all", "selected"] as const;
export type PropertyScope = (typeof PROPERTY_SCOPES)[number];

export const ADMIN_PERMISSIONS = [
  /** Guide and Explore content. */
  "content.read",
  "content.edit",
  /** Service catalog, partner offers, images. */
  "catalog.read",
  "catalog.edit",
  /** Requests: see, approve, reject. */
  "requests.read",
  "requests.decide",
  /** Bookings, orders, stay extensions, audit (read only). */
  "bookings.read",
  /** Property settings: stay extension rules, notifications. */
  "settings.read",
  "settings.edit",
  /** Users and roles. */
  "users.read",
  "users.manage",
  /** Data import from the Extras app (dry run and apply). */
  "migration.run",
  /** The production writer switch (Extras ↔ STAY) – owner only, see go-live plan. */
  "writer.switch",
  /** Unified Inbox (ADR 0023): read guest conversations of a property. */
  "inbox.read",
  /** Reply to guests. */
  "inbox.reply",
  /** Internal notes (read and write) – never visible to guests or to viewers. */
  "inbox.notes",
  /** Assign conversations and change their status. */
  "inbox.assign",
  /** Channels and tenant-wide inbox/push settings. */
  "inbox.manage",
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const MATRIX: Record<AdminRole, ReadonlySet<AdminPermission>> = {
  owner: new Set(ADMIN_PERMISSIONS),
  admin: new Set<AdminPermission>([
    "content.read",
    "content.edit",
    "catalog.read",
    "catalog.edit",
    "requests.read",
    "requests.decide",
    "bookings.read",
    "settings.read",
    "settings.edit",
    "users.read",
    "users.manage",
    "migration.run",
    "inbox.read",
    "inbox.reply",
    "inbox.notes",
    "inbox.assign",
    "inbox.manage",
  ]),
  manager: new Set<AdminPermission>([
    "content.read",
    "content.edit",
    "catalog.read",
    "catalog.edit",
    "requests.read",
    "requests.decide",
    "bookings.read",
    "settings.read",
    "inbox.read",
    "inbox.reply",
    "inbox.notes",
    "inbox.assign",
  ]),
  viewer: new Set<AdminPermission>([
    "content.read",
    "catalog.read",
    "requests.read",
    "bookings.read",
    "settings.read",
  ]),
};

/** Tenant-wide permissions: never granted to users limited to selected properties. */
const TENANT_WIDE: ReadonlySet<AdminPermission> = new Set<AdminPermission>([
  "users.read",
  "users.manage",
  "migration.run",
  "writer.switch",
  "inbox.manage",
]);

/**
 * Permissions that can be granted explicitly in addition to the role (admin_user_grants).
 * Viewers read guest messages only with this grant – never internal notes.
 */
export const GRANTABLE_PERMISSIONS = ["inbox.read"] as const;
export type GrantablePermission = (typeof GRANTABLE_PERMISSIONS)[number];

export function isGrantablePermission(value: unknown): value is GrantablePermission {
  return typeof value === "string" && (GRANTABLE_PERMISSIONS as readonly string[]).includes(value);
}

export type AdminPrincipal = {
  role: AdminRole;
  propertyScope: PropertyScope;
  /** Only meaningful with propertyScope "selected". */
  propertyIds: readonly string[];
  /** Explicit extra permissions (only GRANTABLE_PERMISSIONS take effect). */
  grants?: readonly string[];
};

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}

export function roleHas(role: AdminRole, permission: AdminPermission): boolean {
  return MATRIX[role].has(permission);
}

/** Role permission or an explicit grant of a grantable permission. */
export function principalHas(principal: AdminPrincipal, permission: AdminPermission): boolean {
  if (roleHas(principal.role, permission)) return true;
  return isGrantablePermission(permission) && (principal.grants ?? []).includes(permission);
}

/** True if the principal may act on every property (no property restriction). */
export function hasAllProperties(principal: AdminPrincipal): boolean {
  return principal.role === "owner" || principal.propertyScope === "all";
}

export function canAccessProperty(principal: AdminPrincipal, propertyId: string): boolean {
  return hasAllProperties(principal) || principal.propertyIds.includes(propertyId);
}

/**
 * The single authorization rule:
 * - the role must grant the permission;
 * - tenant-wide permissions require access to all properties;
 * - with a property: that property must be accessible;
 * - without a property (tenant-wide content such as Explore places, shared catalog entries):
 *   write permissions require access to all properties, read permissions are allowed and the
 *   caller filters the result with `canAccessProperty`.
 */
export function can(
  principal: AdminPrincipal,
  permission: AdminPermission,
  target: { propertyId?: string } = {},
): boolean {
  if (!principalHas(principal, permission)) return false;
  if (TENANT_WIDE.has(permission)) return hasAllProperties(principal);
  if (target.propertyId !== undefined) return canAccessProperty(principal, target.propertyId);
  const isRead = permission.endsWith(".read");
  return isRead || hasAllProperties(principal);
}

/**
 * Who may assign which role: owners assign every role; admins assign admin/manager/viewer
 * but never owner and never change an owner. Nobody else manages users.
 */
export function canAssignRole(
  actor: AdminPrincipal,
  current: AdminRole | null,
  next: AdminRole,
): boolean {
  if (!can(actor, "users.manage")) return false;
  if (actor.role === "owner") return true;
  return next !== "owner" && current !== "owner";
}

/** Owners always have all properties; a selected scope needs at least one property. */
export function isValidPrincipalShape(principal: AdminPrincipal): boolean {
  if (principal.role === "owner") return principal.propertyScope === "all";
  return principal.propertyScope === "all" || principal.propertyIds.length > 0;
}
