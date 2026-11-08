/**
 * M0: read-only export of the Extras data (snapshot + SHA-256 manifest + redacted report).
 *
 * Rehearsal without any production access (Extras local fallback file or synthetic data):
 *   pnpm --filter @up/admin extras:export --source local --file ../guest-services/.data/db.json --out <dir>
 *   pnpm --filter @up/admin extras:export --source fixture --out <dir>
 *
 * Production (NOT APPROVED YET – requires the separate approval for reading the productive
 * KV store). Only Upstash's read-only token is accepted; the read/write token is refused:
 *   KV_REST_API_URL=… KV_REST_API_READ_ONLY_TOKEN=… pnpm --filter @up/admin extras:export \
 *     --source kv --confirm-production-read --out <dir outside the repository>
 *
 * Output (files 0600): snapshot.json (minimized, no passwords/guest names/e-mails),
 * manifest.json (checksums), report.md (counts and anomalies only). Nothing is written to KV.
 */
/* eslint-disable no-console -- CLI output */
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildInventory,
  exportSnapshot,
  extrasFixture,
  type KvReader,
  LocalJsonReader,
  renderInventoryMarkdown,
  type Snapshot,
  UpstashReadOnlyReader,
  verifySnapshot,
} from "@up/integrations";

function argument(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

class UsageError extends Error {}

async function readerFor(
  args: readonly string[],
): Promise<{ reader: KvReader; source: Snapshot["source"] }> {
  const source = argument(args, "source");
  if (source === "fixture") {
    return {
      reader: new LocalJsonReader(extrasFixture()),
      source: { kind: "local-json", label: "Synthetische Testdaten" },
    };
  }
  if (source === "local") {
    const file = argument(args, "file");
    if (!file) throw new UsageError("--file is required for --source local");
    const data = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    return {
      reader: new LocalJsonReader(data),
      source: { kind: "local-json", label: `Lokale Datei ${path.basename(file)}` },
    };
  }
  if (source === "kv") {
    if (!args.includes("--confirm-production-read")) {
      throw new UsageError(
        "Reading the productive KV store needs --confirm-production-read (and the separate approval)",
      );
    }
    if (process.env["KV_REST_API_TOKEN"] && !process.env["KV_REST_API_READ_ONLY_TOKEN"]) {
      throw new UsageError(
        "Refusing the read/write KV token – provide KV_REST_API_READ_ONLY_TOKEN only",
      );
    }
    const url = process.env["KV_REST_API_URL"];
    const readOnlyToken = process.env["KV_REST_API_READ_ONLY_TOKEN"];
    if (!url || !readOnlyToken)
      throw new UsageError("KV_REST_API_URL and KV_REST_API_READ_ONLY_TOKEN must be set");
    return {
      reader: new UpstashReadOnlyReader({ url, readOnlyToken, delayMs: 20 }),
      source: {
        kind: "upstash",
        label: `Extras-KV ${new URL(url).hostname.split(".")[0] ?? ""} (nur lesend)`,
      },
    };
  }
  throw new UsageError("--source fixture|local|kv is required");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const out = argument(args, "out");
  if (!out) throw new UsageError("--out <directory> is required");
  const repoRoot = path.resolve(import.meta.dirname, "../../..");
  if (argument(args, "source") === "kv" && path.resolve(out).startsWith(repoRoot)) {
    throw new UsageError("Production snapshots must be written outside the repository");
  }
  const { reader, source } = await readerFor(args);
  console.log(`→ extras export from ${source.label}`);
  const { snapshot, manifest } = await exportSnapshot(reader, { source });
  const integrity = verifySnapshot(snapshot, manifest);
  if (!integrity.ok) throw new Error(`integrity check failed: ${integrity.problems.join(", ")}`);
  const report = renderInventoryMarkdown(buildInventory(snapshot, manifest));
  await mkdir(out, { recursive: true, mode: 0o700 });
  const files = {
    "snapshot.json": JSON.stringify(snapshot, null, 2),
    "manifest.json": JSON.stringify(manifest, null, 2),
    "report.md": report,
  };
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(out, name);
    await writeFile(file, content, { mode: 0o600 });
    await chmod(file, 0o600);
  }
  console.log(`✓ ${manifest.entries.length} keys, sha256 ${manifest.snapshotSha256}`);
}

main().catch((error: unknown) => {
  console.error(
    `✗ ${error instanceof UsageError ? error.message : error instanceof Error ? error.name : "unknown error"}`,
  );
  process.exitCode = 1;
});
