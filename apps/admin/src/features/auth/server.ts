import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { serverEnv } from "../../env/server";
import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { type AdminAuthDeps, type AdminContext, resolveAdminSession } from "./admin-auth-service";
import { adminCookieConfig } from "./session-cookie";

export const adminCookie = adminCookieConfig(serverEnv.APP_ENV);

export function authDeps(): AdminAuthDeps {
  return { db: getDatabase(), logger, now: () => new Date() };
}

export async function readAdminSecret(): Promise<string | undefined> {
  return (await cookies()).get(adminCookie.name)?.value;
}

export async function clientAddress(): Promise<string> {
  const list = await headers();
  return (
    list.get("x-real-ip")?.trim() || list.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}

/** The signed-in admin of this request (checked against the database), cached per request. */
export const getAdminContext = cache(async (): Promise<AdminContext | undefined> => {
  const secret = await readAdminSecret();
  return secret ? resolveAdminSession(authDeps(), secret) : undefined;
});

/** Every admin page and action starts here: no valid session → login. */
export async function requireAdmin(): Promise<AdminContext> {
  const admin = await getAdminContext();
  if (!admin) redirect("/login");
  return admin;
}
