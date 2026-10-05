import { type AppEnvironment } from "@up/core";

/**
 * Admin session cookie: HttpOnly, SameSite=Strict (the admin is only used first-party),
 * Path=/, Secure with `__Host-` prefix outside local. Separate from the guest cookie.
 */
export function adminCookieConfig(appEnv: AppEnvironment): { name: string; secure: boolean } {
  const secure = appEnv !== "local";
  return { name: secure ? "__Host-up_admin_session" : "up_admin_session", secure };
}

export function adminCookieAttributes(secure: boolean, expiresAt: Date, now: Date) {
  return {
    httpOnly: true,
    secure,
    sameSite: "strict" as const,
    path: "/",
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
  };
}
