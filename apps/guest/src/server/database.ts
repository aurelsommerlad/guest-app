import "server-only";

import { createDatabase, type Database } from "@up/db";

import { serverEnv } from "../env/server";

let database: Database | undefined;

/**
 * Server-side database connection, created on first use. Undefined when DATABASE_URL is
 * not configured – features that need it (guest access) then fail closed.
 */
export function getDatabase(): Database | undefined {
  if (!serverEnv.DATABASE_URL) return undefined;
  database ??= createDatabase(serverEnv.DATABASE_URL).db;
  return database;
}
