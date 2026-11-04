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
  /**
   * Supabase project ref (20 lowercase letters/digits) – from the pooler user
   * `postgres.<ref>` or the direct host `db.<ref>.supabase.co`. Not a secret: it
   * identifies the project, so the CLI can check it before changing anything.
   */
  projectRef?: string;
};

const PROJECT_REF = /^[a-z0-9]{20}$/;

function supabaseProjectRef(parsed: URL): string | undefined {
  const user = decodeURIComponent(parsed.username);
  const fromUser = user.startsWith("postgres.") ? user.slice("postgres.".length) : undefined;
  if (fromUser && PROJECT_REF.test(fromUser)) return fromUser;
  const fromHost = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname)?.[1];
  return fromHost;
}

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
  const projectRef = supabaseProjectRef(parsed);
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: parsed.pathname.replace(/^\//, "") || "postgres",
    isLocal: LOCAL_HOSTS.has(parsed.hostname),
    ...(projectRef ? { projectRef } : {}),
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
