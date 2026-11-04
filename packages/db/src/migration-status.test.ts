import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";

import { readMigrationJournal, readMigrationStatus } from "./migration-status";
import { MIGRATIONS_FOLDER } from "./migrations-folder";
import { createTestDatabase } from "./testing/test-database";

describe("migration status", () => {
  it("lists every migration as pending on an empty database, none after migrating", async () => {
    const journal = readMigrationJournal();
    const test = await createTestDatabase();
    try {
      // createTestDatabase migrates already; start from an empty migration table instead.
      await test.client.exec("DROP SCHEMA drizzle CASCADE");
      const fresh = await readMigrationStatus(test.db);
      expect(fresh).toEqual({
        expected: journal.length,
        applied: 0,
        pending: journal.map((entry) => entry.tag),
        unknownApplied: 0,
      });

      await test.client.exec("CREATE SCHEMA drizzle");
      await test.client.exec(
        "CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)",
      );
      // A database at 0007 (staging before Phase 11): 0008… are pending.
      const upTo7 = journal.filter((entry) => entry.idx <= 7);
      for (const entry of upTo7) {
        await test.client.query(
          "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('x', $1)",
          [entry.when],
        );
      }
      const partial = await readMigrationStatus(test.db);
      expect(partial.applied).toBe(upTo7.length);
      expect(partial.pending).toEqual(
        journal.filter((entry) => entry.idx > 7).map((entry) => entry.tag),
      );

      // A database ahead of this branch is reported, not hidden.
      await test.client.query(
        "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('x', $1)",
        [Number.MAX_SAFE_INTEGER],
      );
      const ahead = await readMigrationStatus(test.db);
      expect(ahead.unknownApplied).toBe(1);
      expect(ahead.pending).toEqual([]);
    } finally {
      await test.close();
    }
  });

  it("reports nothing pending for a fully migrated database", async () => {
    const test = await createTestDatabase();
    try {
      await migrate(test.db as never, { migrationsFolder: MIGRATIONS_FOLDER });
      const status = await readMigrationStatus(test.db);
      expect(status.pending).toEqual([]);
      expect(status.applied).toBe(status.expected);
    } finally {
      await test.close();
    }
  });
});
