/**
 * Extras export snapshot (M0): a repeatable, minimized, checksummed copy of the data the
 * migration needs. Personal data is reduced at the source – password hashes, guest names,
 * e-mail addresses, phone numbers and licence plates are never written to the snapshot.
 * Ephemeral keys (locks, rate limits) are counted, not exported.
 */
import { createHash } from "node:crypto";

import { canonicalJson } from "@up/core";

import { type KvReader, type KvType } from "./kv-reader";

export const SNAPSHOT_FORMAT = "extras-snapshot/1";

/** Namespaces that are exported (value) – everything else is only inventoried. */
export const EXPORTED_PATTERNS = [
  "users",
  "catalog:*:items",
  "catalog:*",
  "extension-night:config:*",
  "orders",
  "requests:items",
  "stay-extensions:records",
  "image:*",
] as const;

/** Known ephemeral namespaces: counted with their TTL state (stale locks are an anomaly). */
export const EPHEMERAL_PATTERNS = [
  "ratelimit:*",
  "*:claim:*",
  "request:*",
  "stay-bridge:*",
] as const;

/** Keys removed anywhere in exported values (case-insensitive). */
const PERSONAL_KEYS =
  /^(guestname|guestemail|email|e-mail|phone|phonenumber|mobile|passwordhash|password|token|secret|plate|plates|vehicleplates|licenseplate|licenceplate|firstname|lastname|fullname|comment|note|address)$/i;

export type SnapshotEntry = { key: string; type: KvType; value: unknown };

export type Snapshot = {
  format: typeof SNAPSHOT_FORMAT;
  createdAt: string;
  source: { kind: "upstash" | "local-json"; label: string };
  entries: SnapshotEntry[];
  ephemeral: { key: string; type: KvType; ttl: number }[];
  dbsize: number;
  /** Keys present in the store but in no known namespace. */
  unknownKeys: string[];
  removedFields: Record<string, number>;
};

export type ManifestEntry = { key: string; type: KvType; sha256: string; bytes: number };

export type Manifest = {
  format: typeof SNAPSHOT_FORMAT;
  createdAt: string;
  entries: ManifestEntry[];
  /** SHA-256 over "key\tsha256\n" of all entries in key order. */
  snapshotSha256: string;
};

/** Canonical JSON (sorted object keys) – the basis of every checksum. */
export { canonicalJson };

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function minimize(value: unknown, removed: Record<string, number>): unknown {
  if (Array.isArray(value)) return value.map((item) => minimize(item, removed));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (PERSONAL_KEYS.test(key)) {
        removed[key] = (removed[key] ?? 0) + 1;
        continue;
      }
      out[key] = minimize(child, removed);
    }
    return out;
  }
  return value;
}

function matches(pattern: string, key: string): boolean {
  const regex = new RegExp(
    `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
  );
  return regex.test(key);
}

export async function exportSnapshot(
  reader: KvReader,
  options: { source: Snapshot["source"]; now?: () => Date },
): Promise<{ snapshot: Snapshot; manifest: Manifest }> {
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const removedFields: Record<string, number> = {};
  const exportedKeys = new Set<string>();
  for (const pattern of EXPORTED_PATTERNS) {
    for (const key of await reader.scan(pattern)) exportedKeys.add(key);
  }
  // "catalog:*" also matches the hashes; both legacy arrays and hashes are exported.
  const entries: SnapshotEntry[] = [];
  for (const key of [...exportedKeys].sort()) {
    const type = await reader.type(key);
    let value: unknown;
    if (type === "hash") value = await reader.hgetall(key);
    else if (type === "string") value = await reader.get(key);
    else value = null;
    entries.push({ key, type, value: minimize(value, removedFields) });
  }

  const ephemeral: Snapshot["ephemeral"] = [];
  const ephemeralKeys = new Set<string>();
  for (const pattern of EPHEMERAL_PATTERNS) {
    for (const key of await reader.scan(pattern))
      if (!exportedKeys.has(key)) ephemeralKeys.add(key);
  }
  for (const key of [...ephemeralKeys].sort()) {
    ephemeral.push({ key, type: await reader.type(key), ttl: await reader.ttl(key) });
  }

  const all = await reader.scan("*");
  const unknownKeys = all.filter((key) => !exportedKeys.has(key) && !ephemeralKeys.has(key));

  const snapshot: Snapshot = {
    format: SNAPSHOT_FORMAT,
    createdAt,
    source: options.source,
    entries,
    ephemeral,
    dbsize: await reader.dbsize(),
    unknownKeys,
    removedFields,
  };
  return { snapshot, manifest: buildManifest(snapshot) };
}

export function buildManifest(snapshot: Snapshot): Manifest {
  const entries = snapshot.entries.map((entry) => {
    const json = canonicalJson(entry.value);
    return {
      key: entry.key,
      type: entry.type,
      sha256: sha256(json),
      bytes: Buffer.byteLength(json),
    };
  });
  const snapshotSha256 = sha256(entries.map((entry) => `${entry.key}\t${entry.sha256}\n`).join(""));
  return { format: SNAPSHOT_FORMAT, createdAt: snapshot.createdAt, entries, snapshotSha256 };
}

export type IntegrityResult = { ok: true } | { ok: false; problems: string[] };

/** Re-computes every checksum; any difference (changed, missing, extra key) fails. */
export function verifySnapshot(snapshot: Snapshot, manifest: Manifest): IntegrityResult {
  const problems: string[] = [];
  // Files are read from disk: the format is checked at runtime despite the type.
  if (
    (snapshot.format as string) !== SNAPSHOT_FORMAT ||
    (manifest.format as string) !== SNAPSHOT_FORMAT
  ) {
    problems.push("format");
  }
  const actual = buildManifest(snapshot);
  const expected = new Map(manifest.entries.map((entry) => [entry.key, entry]));
  for (const entry of actual.entries) {
    const want = expected.get(entry.key);
    if (!want) problems.push(`unexpected:${entry.key}`);
    else if (want.sha256 !== entry.sha256) problems.push(`changed:${entry.key}`);
    expected.delete(entry.key);
  }
  for (const key of expected.keys()) problems.push(`missing:${key}`);
  if (actual.snapshotSha256 !== manifest.snapshotSha256) problems.push("snapshot-checksum");
  return problems.length ? { ok: false, problems } : { ok: true };
}

/** Exported entries of one namespace pattern. */
export function entriesMatching(snapshot: Snapshot, pattern: string): SnapshotEntry[] {
  return snapshot.entries.filter((entry) => matches(pattern, entry.key));
}
