"use server";

import { redirect } from "next/navigation";

import { requireAdmin } from "../auth/server";
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
