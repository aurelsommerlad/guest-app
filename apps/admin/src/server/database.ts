import "server-only";

import { createDatabase, type Database } from "@up/db";

import { serverEnv } from "../env/server";

let database: Database | undefined;

export class DatabaseNotConfiguredError extends Error {
  override name = "DatabaseNotConfiguredError";
}

/** The admin cannot work without its database: a missing DATABASE_URL is an error. */
export function getDatabase(): Database {
  if (!serverEnv.DATABASE_URL) throw new DatabaseNotConfiguredError("DATABASE_URL is not set");
  database ??= createDatabase(serverEnv.DATABASE_URL).db;
  return database;
}
