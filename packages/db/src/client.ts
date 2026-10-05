import { drizzle } from "drizzle-orm/postgres-js";
import { type PgDatabase, type PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";

import { schema } from "./schema";

/** Any Drizzle Postgres database with our schema (postgres.js in the app, PGlite in tests). */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export type DatabaseTarget = {
  host: string;
  port: string;
  database: string;
  isLocal: boolean;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Describes a connection string without credentials – safe for logs and CLI prompts.
 * Throws (without echoing the value) if it is not a postgres URL.
 */
export function describeDatabaseUrl(url: string): DatabaseTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres:// or postgresql:// scheme");
  }
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: parsed.pathname.replace(/^\//, "") || "postgres",
    isLocal: LOCAL_HOSTS.has(parsed.hostname),
  };
}

export type DatabaseConnection = {
  db: Database;
  target: DatabaseTarget;
  close: () => Promise<void>;
};

/**
 * Opens a server-side connection (postgres.js).
 *
 * - `prepare: false`: required for the Supabase transaction pooler (port 6543).
 * - TLS is required for every non-local host.
 * - Small pool: serverless functions each hold their own pool; the pooler multiplexes.
 */
export function createDatabase(url: string, options: { maxConnections?: number } = {}) {
  const target = describeDatabaseUrl(url);
  const client = postgres(url, {
    prepare: false,
    max: options.maxConnections ?? 3,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: target.isLocal ? false : "require",
    onnotice: () => undefined,
  });
  return {
    db: drizzle(client, { schema }),
    target,
    close: () => client.end({ timeout: 5 }),
  } satisfies DatabaseConnection;
}
