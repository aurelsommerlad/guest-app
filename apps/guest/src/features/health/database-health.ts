import {
  countAppliedMigrations,
  type Database,
  describeDatabaseUrl,
  projectFingerprint,
} from "@up/db";

export type DatabaseHealth =
  | { status: "not-configured" }
  | { status: "unreachable"; project?: string }
  | { status: "ok"; project?: string; migrations: number };

const TIMEOUT_MS = 3000;

/**
 * Which database this deployment talks to and how far it is migrated – no secrets: the
 * project appears only as a fingerprint (same value as `pnpm db:status` prints), the
 * migration count is the number of rows in drizzle.__drizzle_migrations.
 */
export async function databaseHealth(
  db: Database | undefined,
  databaseUrl: string | undefined,
): Promise<DatabaseHealth> {
  if (!db || !databaseUrl) return { status: "not-configured" };
  const fingerprint = projectFingerprint(describeDatabaseUrl(databaseUrl).projectRef);
  const project = fingerprint ? { project: fingerprint } : {};
  try {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error("timeout"));
      }, TIMEOUT_MS).unref();
    });
    const migrations = await Promise.race([countAppliedMigrations(db), timeout]);
    return { status: "ok", ...project, migrations };
  } catch {
    return { status: "unreachable", ...project };
  }
}
