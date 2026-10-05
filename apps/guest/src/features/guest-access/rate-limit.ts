import { hashSecret } from "@up/core";
import { type Database, hitRateLimit } from "@up/db";

/**
 * Brute-force protection for the booking number login (ADR 0011). Counted in Postgres,
 * so the limit holds across all serverless instances – no in-memory state.
 *
 * - per client address: 10 attempts per 15 minutes (one signal, never a binding)
 * - per booking reference: 5 attempts per 15 minutes (targeted guessing of a last name
 *   from many addresses)
 * Every attempt counts, before the PMS is asked. Keys are SHA-256 hashes.
 */
export const LOGIN_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  maxPerClient: 10,
  maxPerBookingReference: 5,
} as const;

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export async function checkLoginRateLimit(
  db: Database,
  input: { clientAddress: string; bookingReference?: string },
  now: Date,
): Promise<RateLimitDecision> {
  const checks: [string, number][] = [
    [`login-client:${hashSecret(input.clientAddress)}`, LOGIN_RATE_LIMIT.maxPerClient],
  ];
  if (input.bookingReference) {
    checks.push([
      `login-reference:${hashSecret(input.bookingReference)}`,
      LOGIN_RATE_LIMIT.maxPerBookingReference,
    ]);
  }
  let retryAfterMs = 0;
  for (const [key, max] of checks) {
    const bucket = await hitRateLimit(db, key, LOGIN_RATE_LIMIT.windowMs, now);
    if (bucket.hits > max) {
      const windowEnd = bucket.windowStartedAt.getTime() + LOGIN_RATE_LIMIT.windowMs;
      retryAfterMs = Math.max(retryAfterMs, windowEnd - now.getTime());
    }
  }
  return retryAfterMs > 0
    ? { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) }
    : { allowed: true };
}

/** Client address as seen by the platform (Vercel sets x-real-ip / x-forwarded-for). */
export function clientAddressFrom(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}
