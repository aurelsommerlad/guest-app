/**
 * In-memory Postgres for tests (PGlite: Postgres compiled to WASM, in-process).
 * Applies the real migration files – no external database, no credentials, no network.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect } from "vitest";

import { type Database } from "../client";
import { MIGRATIONS_FOLDER } from "../migrations-folder";
import { schema } from "../schema";

export type TestDatabase = {
  db: Database;
  /** Raw PGlite client for catalog queries in tests. */
  client: PGlite;
  close: () => Promise<void>;
};

export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, client, close: () => client.close() };
}

type PgErrorLike = { code?: string; constraint?: string; cause?: unknown };

function pgError(error: unknown): PgErrorLike | undefined {
  let current: unknown = error;
  while (current && typeof current === "object") {
    const candidate = current as PgErrorLike;
    if (typeof candidate.code === "string") return candidate;
    current = candidate.cause;
  }
  return undefined;
}

/** Asserts that the query fails with the given Postgres constraint violation. */
export async function expectConstraintViolation(
  query: PromiseLike<unknown>,
  constraint: string,
): Promise<void> {
  let caught: unknown;
  try {
    await query;
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected violation of ${constraint}`).toBeDefined();
  expect(pgError(caught)?.constraint).toBe(constraint);
}
