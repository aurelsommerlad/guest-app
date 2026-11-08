/**
 * Explicit database CLI – never run automatically on app start or deploy.
 *
 *   DATABASE_URL=… pnpm db:status  --target local|staging|production [--expect-project <ref>]
 *   DATABASE_URL=… pnpm db:migrate --target local|staging|production [--confirm-production]
 *   DATABASE_URL=… pnpm db:seed    --target local|staging|production [--confirm-production]
 *   DATABASE_URL=… pnpm db:test-property --target local|staging    (Apaleo TEST + check-in
 *                                  configuration, insert-only SQL from docs/staging; never production)
 *
 * staging/production additionally require --expect-project <Supabase project ref>: the
 * command refuses to run unless DATABASE_URL points to exactly that project.
 *                                  [--with-preview-fixtures]   (never in production)
 *                                  [--with-guide-fixtures]     (local only)
 *                                  [--with-explore-fixtures]   (local only)
 *                                  [--with-offer-fixtures]     (local only; upselling demo of TEST)
 *                                  [--with-journey-fixtures]   (local only; sample key box
 *                                                               code only if ACCESS_CODE_KEY is set)
 *
 * DATABASE_URL is read from the process environment only (no .env files are loaded),
 * so the operator always decides which database is used.
 */
/* eslint-disable no-console -- CLI output */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { createDatabase, describeDatabaseUrl } from "../client";
import { type MigrationStatus, readMigrationStatus } from "../migration-status";
import { MIGRATIONS_FOLDER } from "../migrations-folder";
import { seedExploreFixtures } from "../seed/explore-fixtures";
import { seedGuideFixtures } from "../seed/guide-fixtures";
import { seedJourneyFixtures } from "../seed/journey-fixtures";
import { seedOfferFixtures } from "../seed/offer-fixtures";
import { previewFixturesSeed } from "../seed/preview-fixtures";
import { seedTenant } from "../seed/seed-tenant";
import { uniquePlacesSeed } from "../seed/unique-places";
import { assertTarget, CliUsageError, parseCliOptions, projectFingerprint } from "./target-guard";

const COMMANDS = ["status", "migrate", "seed", "test-property"] as const;

/** Insert-only setup of the Apaleo test property, in this order (docs/staging/README.md). */
const TEST_PROPERTY_SCRIPTS = ["N-testobjekt-zuordnung.sql", "M-checkin-config-test.sql"];
const STAGING_SQL_FOLDER = join(MIGRATIONS_FOLDER, "..", "..", "..", "docs", "staging");

function printStatus(label: string, status: MigrationStatus): void {
  console.log(
    `${label}: ${String(status.applied)} applied, ${String(status.expected)} in this code base, ` +
      `pending: ${status.pending.length > 0 ? status.pending.join(", ") : "none"}` +
      (status.unknownApplied > 0
        ? ` – ${String(status.unknownApplied)} applied migration(s) unknown to this branch`
        : ""),
  );
}

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
  // Same for EXPLORE: fictitious sample places exist only in local databases.
  const withExploreFixtures = args.includes("--with-explore-fixtures");
  if (withExploreFixtures && options.target !== "local") {
    throw new CliUsageError("--with-explore-fixtures is only allowed with --target local");
  }
  // Upselling demo offers with placeholder photos: local databases only (staging: script U).
  const withOfferFixtures = args.includes("--with-offer-fixtures");
  if (withOfferFixtures && options.target !== "local") {
    throw new CliUsageError("--with-offer-fixtures is only allowed with --target local");
  }
  // Sample online check-in settings and key box code: local databases only.
  const withJourneyFixtures = args.includes("--with-journey-fixtures");
  if (withJourneyFixtures && options.target !== "local") {
    throw new CliUsageError("--with-journey-fixtures is only allowed with --target local");
  }
  if (command === "test-property" && options.target === "production") {
    throw new CliUsageError("test-property is not allowed in production");
  }
  const url = process.env["DATABASE_URL"];
  if (!url) throw new CliUsageError("DATABASE_URL is not set");
  const target = describeDatabaseUrl(url);
  assertTarget(options, target, { requireProject: true });

  const fingerprint = projectFingerprint(target.projectRef);
  console.log(
    `→ ${command} on ${options.target}: ${target.host}:${target.port}/${target.database}` +
      (fingerprint ? ` (project fingerprint ${fingerprint})` : ""),
  );

  const { db, close } = createDatabase(url, { maxConnections: 1 });
  try {
    if (command === "status") {
      const status = await readMigrationStatus(db);
      printStatus("migrations", status);
      if (status.pending.length > 0) process.exitCode = 2;
    } else if (command === "migrate") {
      const before = await readMigrationStatus(db);
      printStatus("before", before);
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      const after = await readMigrationStatus(db);
      printStatus("after", after);
      if (after.pending.length > 0) throw new Error("migrations are still pending");
      console.log("✓ migrations applied");
    } else if (command === "test-property") {
      // Plain SQL files with their own guards and transactions (simple query protocol).
      const client = postgres(url, {
        prepare: false,
        max: 1,
        onnotice: () => {},
        ...(target.isLocal ? {} : { ssl: "require" as const }),
      });
      try {
        for (const file of TEST_PROPERTY_SCRIPTS) {
          await client.unsafe(readFileSync(join(STAGING_SQL_FOLDER, file), "utf8"));
          console.log(`✓ ${file}`);
        }
      } finally {
        await client.end();
      }
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
      if (withOfferFixtures) {
        const count = await seedOfferFixtures(
          db,
          { tenantId: uniquePlacesSeed.tenant.id },
          { withImages: true },
        );
        console.log("✓ Upselling demo offers for TEST (local only) – offers written:", count);
      }
      if (withExploreFixtures) {
        const explore = await seedExploreFixtures(db, { tenantId: uniquePlacesSeed.tenant.id });
        console.log(
          "✓ EXPLORE development fixtures (local only) – places written:",
          explore.written,
        );
      }
      if (withJourneyFixtures) {
        const accessCodeKey = process.env["ACCESS_CODE_KEY"];
        const journey = await seedJourneyFixtures(
          db,
          { tenantId: uniquePlacesSeed.tenant.id },
          accessCodeKey ? { accessCodeKey } : {},
        );
        console.log(
          "✓ guest journey fixtures (local only) – properties:",
          journey.properties,
          "key box codes:",
          journey.codes,
        );
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
