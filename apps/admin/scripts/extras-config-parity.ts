/**
 * Configuration parity Extras → STAY, field by field, per property and service (before M5).
 * Reads only a snapshot file – no database, no Apaleo, nothing is written anywhere else.
 *
 *   pnpm --filter @up/admin extras:config-parity \
 *     --snapshot <dir>/snapshot.json --manifest <dir>/manifest.json \
 *     --json <out>.json [--md <out>.md]
 *
 * The basis is "m0-export" only for a verified snapshot read from the production store
 * (source "upstash"); anything else is reported as synthetic and is no proof of the production
 * configuration. Output files are written with mode 0600 – they contain configuration only (no
 * guest data), but must not be committed when they come from production.
 */
/* eslint-disable no-console -- CLI output */
import { readFile, writeFile } from "node:fs/promises";

import { CliUsageError, compareExtrasConfiguration, renderConfigParityMarkdown } from "@up/db";
import { type Manifest, type Snapshot, verifySnapshot } from "@up/integrations";

function argument(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const snapshotFile = argument(args, "snapshot");
  const manifestFile = argument(args, "manifest");
  const jsonFile = argument(args, "json");
  if (!snapshotFile || !manifestFile || !jsonFile)
    throw new CliUsageError("--snapshot, --manifest and --json are required");
  const snapshot = JSON.parse(await readFile(snapshotFile, "utf8")) as Snapshot;
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as Manifest;
  const integrity = verifySnapshot(snapshot, manifest);
  if (!integrity.ok)
    throw new CliUsageError(
      `snapshot integrity check failed (${String(integrity.problems.length)} problems)`,
    );
  const report = compareExtrasConfiguration(snapshot, {
    basis: snapshot.source.kind === "upstash" ? "m0-export" : "synthetic",
    snapshotSha256: manifest.snapshotSha256,
  });
  await writeFile(jsonFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  const mdFile = argument(args, "md");
  if (mdFile) await writeFile(mdFile, renderConfigParityMarkdown(report), { mode: 0o600 });
  console.log(
    `✓ ${report.basis}: ${Object.entries(report.summary)
      .map(([k, v]) => `${k} ${String(v)}`)
      .join(", ")}`,
  );
}

main().catch((error: unknown) => {
  console.error(
    `✗ ${error instanceof CliUsageError ? error.message : error instanceof Error ? error.name : "unknown error"}`,
  );
  process.exitCode = 1;
});
