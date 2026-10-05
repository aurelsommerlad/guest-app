import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { serverEnv } from "../../env/server";
import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import {
  type CurrentGuestAccess,
  type GuestAccessDeps,
  resolveGuestSession,
} from "./guest-access-service";
import { sessionCookieConfig } from "./session-cookie";

export const guestSessionCookie = sessionCookieConfig(serverEnv.APP_ENV);

/** Undefined when no database is configured: guest access then fails closed. */
export function getGuestAccessDeps(): GuestAccessDeps | undefined {
  const db = getDatabase();
  if (!db) return undefined;
  return { db, logger, now: () => new Date() };
}

export async function readSessionSecret(): Promise<string | undefined> {
  return (await cookies()).get(guestSessionCookie.name)?.value;
}

/**
 * The current guest's access, from the session cookie – checked against the database on
 * every request (revocation takes effect immediately). Cached per request.
 */
export const getCurrentGuestAccess = cache(async (): Promise<CurrentGuestAccess | undefined> => {
  const secret = await readSessionSecret();
  if (!secret) return undefined;
  const deps = getGuestAccessDeps();
  return deps ? resolveGuestSession(deps, secret) : undefined;
});
