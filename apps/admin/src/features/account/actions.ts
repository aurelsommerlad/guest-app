"use server";

import { authDeps, readAdminSecret, requireAdmin } from "../auth/server";
import { changeOwnPassword } from "./account-service";

export type PasswordFormState =
  { status: "idle" } | { status: "error" | "success"; message: string };

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, 300) : "";
};

export async function changePasswordAction(
  _previous: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const admin = await requireAdmin();
  const result = await changeOwnPassword(
    authDeps(),
    admin,
    {
      current: field(formData, "current"),
      next: field(formData, "next"),
      confirm: field(formData, "confirm"),
    },
    await readAdminSecret(),
  );
  if (!result.ok) return { status: "error", message: result.error };
  return {
    status: "success",
    message:
      result.revokedSessions > 0
        ? `Passwort geändert. ${String(result.revokedSessions)} andere Anmeldung(en) wurden beendet.`
        : "Passwort geändert.",
  };
}
