import { type AppEnvironment } from "@up/core";

/**
 * Guest session cookie (ADR 0011): opaque secret, HttpOnly, SameSite=Lax (the link is
 * opened from e-mails/messengers – a top-level cross-site navigation), Path=/.
 * Outside local it is Secure and uses the `__Host-` prefix (no Domain, HTTPS only).
 */
export type SessionCookieConfig = { name: string; secure: boolean };

export function sessionCookieConfig(appEnv: AppEnvironment): SessionCookieConfig {
  const secure = appEnv !== "local";
  return { name: secure ? "__Host-up_guest_session" : "up_guest_session", secure };
}

export function sessionCookieAttributes(
  config: SessionCookieConfig,
  expiresAt: Date,
  now: Date,
): { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/"; maxAge: number } {
  return {
    httpOnly: true,
    secure: config.secure,
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
  };
}
