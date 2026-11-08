/**
 * M1-D: import an Extras snapshot (from extras:export) into a STAY database – dry run by
 * default, idempotent, with conflict detection and a reconciliation report.
 *
 *   DATABASE_URL=… pnpm --filter @up/admin extras:import --target local|staging \
 *     --tenant unique-places --snapshot <dir>/snapshot.json --manifest <dir>/manifest.json \
 *     [--apply] [--report <file>]
 *
 * The production database is refused (its setup and migration are not approved).
 * The snapshot's checksums are verified before anything is read into the database.
 */
/* eslint-disable no-console -- CLI output */
import { readFile, writeFile } from "node:fs/promises";

import {
  assertDatabaseTarget,
  CliUsageError,
  createDatabase,
  describeDatabaseUrl,
  getTenantBySlug,
  importExtrasSnapshot,
  parseDatabaseCliOptions,
  reconcileExtras,
  renderImportReport,
} from "@up/db";
import { type Manifest, type Snapshot, verifySnapshot } from "@up/integrations";

function argument(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseDatabaseCliOptions(args);
  if (options.target === "production") {
    throw new CliUsageError("The STAY production database is not approved for the Extras import");
  }
  const url = process.env["DATABASE_URL"];
  if (!url) throw new CliUsageError("DATABASE_URL is not set");
  const target = describeDatabaseUrl(url);
  assertDatabaseTarget(options, target);
  const tenantSlug = argument(args, "tenant");
  const snapshotFile = argument(args, "snapshot");
  const manifestFile = argument(args, "manifest");
  if (!tenantSlug || !snapshotFile || !manifestFile) {
    throw new CliUsageError("--tenant, --snapshot and --manifest are required");
  }
  const snapshot = JSON.parse(await readFile(snapshotFile, "utf8")) as Snapshot;
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as Manifest;
  const integrity = verifySnapshot(snapshot, manifest);
  if (!integrity.ok)
    throw new CliUsageError(
      `snapshot integrity check failed (${integrity.problems.length} problems)`,
    );
  const mode = args.includes("--apply") ? "apply" : "dry-run";

  console.log(`→ extras import (${mode}) on ${options.target}: ${target.host}/${target.database}`);
  const { db, close } = createDatabase(url, { maxConnections: 1 });
  try {
    const tenant = await getTenantBySlug(db, tenantSlug);
    if (!tenant) throw new CliUsageError("unknown tenant");
    const context = { tenantId: tenant.id };
    const result = await importExtrasSnapshot(db, context, snapshot, {
      mode,
      snapshotSha256: manifest.snapshotSha256,
      actorAdminId: null,
      now: new Date(),
    });
    const report = renderImportReport(result, await reconcileExtras(db, context, snapshot));
    const reportFile = argument(args, "report");
    if (reportFile) await writeFile(reportFile, report, { mode: 0o600 });
    else console.log(report);
    console.log(`✓ run ${result.runId}`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(
    `✗ ${error instanceof CliUsageError ? error.message : error instanceof Error ? error.name : "unknown error"}`,
  );
  process.exitCode = 1;
});
