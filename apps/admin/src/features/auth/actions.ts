"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { serverEnv } from "../../env/server";
import { loginAdmin, logoutAdmin, setupFirstAdmin } from "./admin-auth-service";
import { adminCookie, authDeps, clientAddress, readAdminSecret } from "./server";
import { adminCookieAttributes } from "./session-cookie";

export type AuthFormState = { status: "idle" } | { status: "error"; message: string };

function field(formData: FormData, name: string, max: number): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
}

async function setSessionCookie(session: { secret: string; expiresAt: Date }): Promise<void> {
  (await cookies()).set(
    adminCookie.name,
    session.secret,
    adminCookieAttributes(adminCookie.secure, session.expiresAt, new Date()),
  );
}

export async function loginAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const result = await loginAdmin(
    authDeps(),
    {
      email: field(formData, "email", 254),
      password: field(formData, "password", 200),
      clientAddress: await clientAddress(),
    },
    await readAdminSecret(),
  );
  if (result.ok) {
    await setSessionCookie(result.session);
    redirect("/");
  }
  return {
    status: "error",
    message:
      result.reason === "rate-limited"
        ? "Zu viele Versuche. Bitte versuche es in 15 Minuten erneut."
        : "E-Mail oder Passwort ist nicht korrekt.",
  };
}

export async function logoutAction(): Promise<void> {
  await logoutAdmin(authDeps(), await readAdminSecret());
  (await cookies()).delete(adminCookie.name);
  redirect("/login");
}

export async function setupAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const password = field(formData, "password", 200);
  if (password !== field(formData, "passwordRepeat", 200)) {
    return { status: "error", message: "Die Passwörter stimmen nicht überein." };
  }
  const result = await setupFirstAdmin(authDeps(), serverEnv.ADMIN_SETUP_TOKEN, {
    setupToken: field(formData, "setupToken", 500),
    tenantSlug: field(formData, "tenantSlug", 64),
    email: field(formData, "email", 254),
    password,
    clientAddress: await clientAddress(),
  });
  if (result.ok) {
    await setSessionCookie(result.session);
    redirect("/");
  }
  const messages = {
    unavailable: "Die Ersteinrichtung ist nicht (mehr) verfügbar.",
    "invalid-token": "Der Einrichtungsschlüssel ist nicht korrekt.",
    "invalid-input": "Bitte prüfe Mandant, E-Mail und Passwort (mindestens 12 Zeichen).",
    "rate-limited": "Zu viele Versuche. Bitte versuche es später erneut.",
  } as const;
  return { status: "error", message: messages[result.reason] };
}
