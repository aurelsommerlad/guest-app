import { describe, expect, it } from "vitest";

import {
  ADMIN_PERMISSIONS,
  type AdminPrincipal,
  can,
  canAccessProperty,
  canAssignRole,
  isValidPrincipalShape,
  roleHas,
} from "./permissions";

const owner: AdminPrincipal = { role: "owner", propertyScope: "all", propertyIds: [] };
const admin: AdminPrincipal = { role: "admin", propertyScope: "all", propertyIds: [] };
const manager: AdminPrincipal = { role: "manager", propertyScope: "all", propertyIds: [] };
const viewer: AdminPrincipal = { role: "viewer", propertyScope: "all", propertyIds: [] };
const hovManager: AdminPrincipal = {
  role: "manager",
  propertyScope: "selected",
  propertyIds: ["hov"],
};
const hovAdmin: AdminPrincipal = { role: "admin", propertyScope: "selected", propertyIds: ["hov"] };

describe("role matrix", () => {
  it("owner has every permission", () => {
    for (const permission of ADMIN_PERMISSIONS) expect(roleHas("owner", permission)).toBe(true);
  });

  it("only owners switch the production writer", () => {
    expect(can(owner, "writer.switch")).toBe(true);
    for (const principal of [admin, manager, viewer])
      expect(can(principal, "writer.switch")).toBe(false);
  });

  it("managers edit the catalog and decide requests, but neither settings nor users", () => {
    expect(can(manager, "catalog.edit", { propertyId: "hov" })).toBe(true);
    expect(can(manager, "requests.decide", { propertyId: "hov" })).toBe(true);
    expect(can(manager, "settings.edit", { propertyId: "hov" })).toBe(false);
    expect(can(manager, "users.manage")).toBe(false);
  });

  it("viewers read only – no action button may ever be authorized for them", () => {
    for (const permission of ADMIN_PERMISSIONS) {
      expect(can(viewer, permission, { propertyId: "hov" })).toBe(
        permission.endsWith(".read") && permission !== "users.read",
      );
    }
  });
});

describe("property scope", () => {
  it("limits property-bound actions to the selected properties", () => {
    expect(can(hovManager, "catalog.edit", { propertyId: "hov" })).toBe(true);
    expect(can(hovManager, "catalog.edit", { propertyId: "huesle" })).toBe(false);
    expect(can(hovManager, "requests.read", { propertyId: "huesle" })).toBe(false);
    expect(canAccessProperty(hovManager, "huesle")).toBe(false);
  });

  it("tenant-wide writes need all properties; tenant-wide reads are filtered by the caller", () => {
    expect(can(hovManager, "content.edit")).toBe(false);
    expect(can(manager, "content.edit")).toBe(true);
    expect(can(hovManager, "content.read")).toBe(true);
  });

  it("user management and import are tenant-wide: a property-limited admin gets neither", () => {
    expect(can(hovAdmin, "users.manage")).toBe(false);
    expect(can(hovAdmin, "migration.run")).toBe(false);
    expect(can(admin, "users.manage")).toBe(true);
  });

  it("owners always see every property", () => {
    expect(
      canAccessProperty({ role: "owner", propertyScope: "selected", propertyIds: [] }, "x"),
    ).toBe(true);
    expect(
      isValidPrincipalShape({ role: "owner", propertyScope: "selected", propertyIds: ["hov"] }),
    ).toBe(false);
    expect(
      isValidPrincipalShape({ role: "viewer", propertyScope: "selected", propertyIds: [] }),
    ).toBe(false);
    expect(isValidPrincipalShape(hovManager)).toBe(true);
  });
});

describe("role assignment", () => {
  it("owners assign every role; admins never create or change owners", () => {
    expect(canAssignRole(owner, "viewer", "owner")).toBe(true);
    expect(canAssignRole(admin, "viewer", "manager")).toBe(true);
    expect(canAssignRole(admin, "viewer", "owner")).toBe(false);
    expect(canAssignRole(admin, "owner", "viewer")).toBe(false);
    expect(canAssignRole(manager, "viewer", "viewer")).toBe(false);
    expect(canAssignRole(hovAdmin, "viewer", "viewer")).toBe(false);
  });
});
