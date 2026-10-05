/**
 * Explicit database CLI – never run automatically on app start or deploy.
 *
 *   DATABASE_URL=… pnpm db:migrate --target local|staging|production [--confirm-production]
 *   DATABASE_URL=… pnpm db:seed    --target local|staging|production [--confirm-production]
 *                                  [--with-preview-fixtures]   (never in production)
 *                                  [--with-guide-fixtures]     (local only)
 *
 * DATABASE_URL is read from the process environment only (no .env files are loaded),
 * so the operator always decides which database is used.
 */
/* eslint-disable no-console -- CLI output */
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDatabase, describeDatabaseUrl } from "../client";
import { MIGRATIONS_FOLDER } from "../migrations-folder";
import { seedGuideFixtures } from "../seed/guide-fixtures";
import { previewFixturesSeed } from "../seed/preview-fixtures";
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
  const withPreviewFixtures = args.includes("--with-preview-fixtures");
  if (withPreviewFixtures && options.target === "production") {
    throw new CliUsageError("--with-preview-fixtures is not allowed in production");
  }
  // Mock GUIDE content never leaves local databases (staging gets real content via admin).
  const withGuideFixtures = args.includes("--with-guide-fixtures");
  if (withGuideFixtures && options.target !== "local") {
    throw new CliUsageError("--with-guide-fixtures is only allowed with --target local");
  }
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
      if (withPreviewFixtures) {
        const fixtures = await seedTenant(db, previewFixturesSeed);
        console.log("✓ preview fixtures (Apaleo TEST) – rows written:", fixtures.written);
      }
      if (withGuideFixtures) {
        const guide = await seedGuideFixtures(db, { tenantId: uniquePlacesSeed.tenant.id });
        console.log("✓ GUIDE development fixtures (local only) – topics written:", guide.written);
      }
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
