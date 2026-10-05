import { lt, sql } from "drizzle-orm";

import { type Database } from "../client";
import { rateLimitBuckets } from "../schema";

const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Atomically counts one hit in a fixed window and returns the count (shared by all
 * serverless instances – the database is the single source of truth). Old buckets are
 * pruned on the way, so the table stays small and holds no long-lived identifiers.
 */
export async function hitRateLimit(
  db: Database,
  key: string,
  windowMs: number,
  now: Date,
): Promise<{ hits: number; windowStartedAt: Date }> {
  if (key.length === 0 || key.length > 128) throw new TypeError("Invalid rate limit key");
  // Raw SQL fragments get ISO strings with an explicit cast: postgres.js (unlike PGlite)
  // does not serialise Date objects outside of typed column values.
  const windowStart = sql`${new Date(now.getTime() - windowMs).toISOString()}::timestamptz`;
  const nowValue = sql`${now.toISOString()}::timestamptz`;
  await db
    .delete(rateLimitBuckets)
    .where(lt(rateLimitBuckets.windowStartedAt, new Date(now.getTime() - PRUNE_AFTER_MS)));
  const [row] = await db
    .insert(rateLimitBuckets)
    .values({ key, windowStartedAt: now, hits: 1 })
    .onConflictDoUpdate({
      target: rateLimitBuckets.key,
      set: {
        hits: sql`CASE WHEN ${rateLimitBuckets.windowStartedAt} <= ${windowStart} THEN 1 ELSE ${rateLimitBuckets.hits} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${rateLimitBuckets.windowStartedAt} <= ${windowStart} THEN ${nowValue} ELSE ${rateLimitBuckets.windowStartedAt} END`,
      },
    })
    .returning({ hits: rateLimitBuckets.hits, windowStartedAt: rateLimitBuckets.windowStartedAt });
  if (!row) throw new Error("Rate limit bucket was not written");
  return row;
}
