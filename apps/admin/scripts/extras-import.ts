/**
 * M1-D: import an Extras snapshot (from extras:export) into a STAY database – dry run by
 * default, idempotent, with conflict detection and a reconciliation report.
 *
 *   DATABASE_URL=… pnpm --filter @up/admin extras:import --target local|staging \
 *     --tenant unique-places --snapshot <dir>/snapshot.json --manifest <dir>/manifest.json \
 *     [--apply] [--report <file>] [--images] [--upload-images] [--slack-route <name>]
 *
 * --images         adds the image migration plan (checksum, type, dimensions, references).
 * --slack-route    Slack route for every imported property without one (Extras posts all
 *                  requests to one webhook; the webhook itself stays in the environment).
 * --upload-images  with --apply: uploads referenced images to the storage area "offers"
 *                  (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GUIDE_MEDIA_BUCKET) and sets them
 *                  where STAY has no image yet. Never replaces an image chosen in STAY.
 *
 * The production database is refused (its setup and migration are not approved).
 * The snapshot's checksums are verified before anything is read into the database.
 */
/* eslint-disable no-console -- CLI output */
import { readFile, writeFile } from "node:fs/promises";

import {
  applyImageMigration,
  assertDatabaseTarget,
  CliUsageError,
  createDatabase,
  describeDatabaseUrl,
  getTenantBySlug,
  importExtrasSnapshot,
  parseDatabaseCliOptions,
  planImageMigration,
  reconcileExtras,
  renderImportReport,
} from "@up/db";
import { type Manifest, type Snapshot, verifySnapshot } from "@up/integrations";

import {
  createSignedImageUpload,
  mediaImagePath,
  publicImageUrl,
} from "../src/server/media-storage";

function renderImagePlan(plan: ReturnType<typeof planImageMigration>): string {
  const lines = [
    "",
    "## Bilder",
    "",
    "| Bild | Bytes | Typ | Größe | SHA-256 | Verwendet von | Hinweise |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...plan.map(
      (p) =>
        `| ${p.imageId.slice(0, 8)} | ${String(p.bytes)} | ${p.info?.type ?? p.storedContentType ?? "–"} | ${
          p.info ? `${String(p.info.width)}×${String(p.info.height)}` : "–"
        } | ${p.sha256?.slice(0, 12) ?? "–"} | ${p.references.join(", ") || "–"} | ${p.issues.join(", ") || "–"} |`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}

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
      ...(argument(args, "slack-route") ? { slackRoute: argument(args, "slack-route") } : {}),
    });
    let report = renderImportReport(result, await reconcileExtras(db, context, snapshot));
    if (args.includes("--images") || args.includes("--upload-images")) {
      const plan = planImageMigration(snapshot);
      report += renderImagePlan(plan);
      if (args.includes("--upload-images")) {
        if (mode !== "apply") throw new CliUsageError("--upload-images requires --apply");
        const supabaseUrl = process.env["SUPABASE_URL"];
        const serverKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
        const bucket = process.env["GUIDE_MEDIA_BUCKET"] ?? "guide-media";
        if (!supabaseUrl || !serverKey) throw new CliUsageError("storage is not configured");
        const storage = { supabaseUrl, serverKey, bucket };
        const applied = await applyImageMigration(
          db,
          context,
          snapshot,
          plan,
          async ({ bytes, info }) => {
            const path = mediaImagePath(
              { tenantId: context.tenantId, module: "offers" },
              info.type,
            );
            const { uploadUrl } = await createSignedImageUpload(storage, path);
            const response = await fetch(uploadUrl, {
              method: "PUT",
              headers: { "Content-Type": info.type },
              body: Buffer.from(bytes),
            });
            if (!response.ok)
              throw new CliUsageError(`image upload failed (${String(response.status)})`);
            return { src: publicImageUrl(storage, path) };
          },
        );
        report += `\nBilder hochgeladen: ${String(applied.uploaded)}, gesetzt: ${String(applied.heroImagesSet.length)}, übersprungen: ${String(applied.skipped.length)}\n`;
      }
    }
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
