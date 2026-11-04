import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type SQL, sql } from "drizzle-orm";

import { type Database } from "./client";
import { MIGRATIONS_FOLDER } from "./migrations-folder";

type JournalEntry = { idx: number; when: number; tag: string };

/** The migrations this code base ships (Drizzle journal order). */
export function readMigrationJournal(folder = MIGRATIONS_FOLDER): JournalEntry[] {
  const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as {
    entries: JournalEntry[];
  };
  return [...journal.entries].sort((a, b) => a.idx - b.idx);
}

export type MigrationStatus = {
  /** Migrations in this code base. */
  expected: number;
  /** Rows in drizzle.__drizzle_migrations (0 for a fresh database). */
  applied: number;
  /** Tags the Drizzle migrator would apply now (newer than the latest applied one). */
  pending: string[];
  /** Applied migrations this code base does not know (database ahead of this branch). */
  unknownApplied: number;
};

/** Raw query rows – postgres.js returns an array, PGlite an object with `rows`. */
async function rowsOf<T>(db: Database, query: SQL): Promise<T[]> {
  const result: unknown = await db.execute(query);
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []);
}

/** Read-only: compares the database's migration table with the journal. */
export async function readMigrationStatus(
  db: Database,
  journal: readonly JournalEntry[] = readMigrationJournal(),
): Promise<MigrationStatus> {
  const [presence] = await rowsOf<{ present: boolean }>(
    db,
    sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`,
  );
  const rows = presence?.present
    ? await rowsOf<{ created_at: string }>(
        db,
        sql`SELECT created_at::text AS created_at FROM drizzle.__drizzle_migrations`,
      )
    : [];
  const appliedWhen = rows.map((row) => Number(row.created_at));
  const latest = appliedWhen.length > 0 ? Math.max(...appliedWhen) : -Infinity;
  const known = new Set(journal.map((entry) => entry.when));
  return {
    expected: journal.length,
    applied: rows.length,
    pending: journal.filter((entry) => entry.when > latest).map((entry) => entry.tag),
    unknownApplied: appliedWhen.filter((when) => !known.has(when)).length,
  };
}
