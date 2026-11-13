"use server";

import { redirect } from "next/navigation";

import { canAssignRole } from "@up/core";
import { getAdminUser, setAdminUserGrant } from "@up/db";

import { getDatabase } from "../../server/database";
import { principalOf } from "../auth/authorization";
import { requireAdmin, requirePermission } from "../auth/server";
import { teamDeps } from "./server";
import {
  changeMemberAccess,
  inviteMember,
  revokeInvitation,
  setMemberStatus,
} from "./team-service";

export type InviteFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  /** The link is shown once – only its hash is stored. */
  | { status: "created"; message: string; path: string; expiresAt: string };

export type AccessFormState = { status: "idle" } | { status: "saved" | "error"; message: string };

function field(formData: FormData, name: string, max: number): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
}

function accessInput(formData: FormData) {
  return {
    role: field(formData, "role", 20),
    propertyScope: field(formData, "propertyScope", 20),
    propertyIds: formData
      .getAll("propertyIds")
      .filter((value): value is string => typeof value === "string")
      .slice(0, 100),
  };
}

export async function inviteMemberAction(
  _previous: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const admin = await requireAdmin();
  const result = await inviteMember(teamDeps(), admin, {
    email: field(formData, "email", 254),
    ...accessInput(formData),
  });
  if (!result.ok) return { status: "error", message: result.error };
  return {
    status: "created",
    message: "Einladung erstellt. Der Link wird nur jetzt angezeigt.",
    path: result.path,
    expiresAt: result.expiresAt.toISOString(),
  };
}

export async function changeAccessAction(
  userId: string,
  _previous: AccessFormState,
  formData: FormData,
): Promise<AccessFormState> {
  const admin = await requireAdmin();
  const result = await changeMemberAccess(teamDeps(), admin, userId, accessInput(formData));
  return result.ok
    ? { status: "saved", message: "Gespeichert. Gilt ab der nächsten Aktion des Mitglieds." }
    : { status: "error", message: result.error };
}

export async function setMemberStatusAction(
  userId: string,
  status: "active" | "disabled",
): Promise<void> {
  const admin = await requireAdmin();
  const result = await setMemberStatus(
    teamDeps(),
    admin,
    userId,
    status === "disabled" ? "disabled" : "active",
  );
  redirect(
    `/team/${encodeURIComponent(userId)}${result.ok ? "" : `?error=${encodeURIComponent(result.error)}`}`,
  );
}

export async function revokeInvitationAction(invitationId: string): Promise<void> {
  const admin = await requireAdmin();
  await revokeInvitation(teamDeps(), admin, invitationId);
  redirect("/team");
}

/**
 * Explicit message reading for a viewer (ADR 0023): viewers see guest messages only with this
 * grant – never internal notes, never replies. Owners/admins with users.manage decide.
 */
export async function setInboxReadGrantAction(userId: string, granted: boolean): Promise<void> {
  const admin = await requirePermission("users.manage");
  const db = getDatabase();
  const member = await getAdminUser(db, { tenantId: admin.tenantId }, userId);
  if (!member || !canAssignRole(principalOf(admin), member.role, member.role)) redirect("/team");
  if (member.role !== "viewer") {
    redirect(
      `/team/${encodeURIComponent(userId)}?error=${encodeURIComponent("Nur für Leserechte nötig – andere Rollen lesen Nachrichten bereits.")}`,
    );
  }
  await setAdminUserGrant(
    db,
    { tenantId: admin.tenantId },
    {
      adminUserId: member.id,
      permission: "inbox.read",
      granted,
      actorAdminId: admin.adminUserId,
    },
  );
  redirect(`/team/${encodeURIComponent(userId)}`);
}
