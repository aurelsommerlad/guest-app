/**
 * Explicit database CLI – never run automatically on app start or deploy.
 *
 *   DATABASE_URL=… pnpm db:migrate --target local|staging|production [--confirm-production]
 *   DATABASE_URL=… pnpm db:seed    --target local|staging|production [--confirm-production]
 *
 * DATABASE_URL is read from the process environment only (no .env files are loaded),
 * so the operator always decides which database is used.
 */
/* eslint-disable no-console -- CLI output */
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDatabase, describeDatabaseUrl } from "../client";
import { MIGRATIONS_FOLDER } from "../migrations-folder";
import { seedTenant } from "../seed/seed-tenant";
import { uniquePlacesSeed } from "../seed/unique-places";
import { assertTarget, CliUsageError, parseCliOptions } from "./target-guard";

const COMMANDS = ["migrate", "seed"] as const;

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    throw new CliUsageError(`command must be one of: ${COMMANDS.join(", ")}`);
  }
  const options = parseCliOptions(args);
  const url = process.env["DATABASE_URL"];
  if (!url) throw new CliUsageError("DATABASE_URL is not set");
  const target = describeDatabaseUrl(url);
  assertTarget(options, target);

  console.log(
    `→ ${command} on ${options.target}: ${target.host}:${target.port}/${target.database}`,
  );

  const { db, close } = createDatabase(url, { maxConnections: 1 });
  try {
    if (command === "migrate") {
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      console.log("✓ migrations applied");
    } else {
      const result = await seedTenant(db, uniquePlacesSeed);
      console.log("✓ seed UNIQUE PLACES – rows written:", result.written);
    }
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  // Error messages never contain the connection string.
  const message = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
  console.error(`✗ ${message}`);
  process.exitCode = 1;
});
