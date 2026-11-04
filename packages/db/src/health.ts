import { sql } from "drizzle-orm";

import { type Database } from "./client";

/** Rows in drizzle.__drizzle_migrations – for health checks (no journal, no file access). */
export async function countAppliedMigrations(db: Database): Promise<number> {
  const result: unknown = await db.execute(
    sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`,
  );
  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
  const count = Number((rows[0] as { n?: unknown } | undefined)?.n);
  if (!Number.isInteger(count)) throw new Error("unexpected migration count");
  return count;
}
