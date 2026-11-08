/**
 * Read-only access to the Extras key-value store (M0).
 *
 * Only the commands in READ_COMMANDS can ever be sent – the reader refuses anything else
 * before a request is made. The production export additionally requires Upstash's
 * read-only token (KV_REST_API_READ_ONLY_TOKEN); the read/write token is refused by name.
 * Running the reader against the production store needs a separate approval.
 */

export const READ_COMMANDS = ["SCAN", "TYPE", "GET", "HGETALL", "TTL", "DBSIZE"] as const;
export type ReadCommand = (typeof READ_COMMANDS)[number];

export type KvType = "string" | "hash" | "list" | "set" | "zset" | "none" | "other";

export interface KvReader {
  /** All keys matching a glob pattern (SCAN, never KEYS). */
  scan(pattern: string): Promise<string[]>;
  type(key: string): Promise<KvType>;
  /** Parsed JSON value of a string key (or the raw string if it is not JSON). */
  get(key: string): Promise<unknown>;
  /** Hash fields with parsed JSON values. */
  hgetall(key: string): Promise<Record<string, unknown>>;
  /** Seconds to live; -1 = no expiry, -2 = missing. */
  ttl(key: string): Promise<number>;
  dbsize(): Promise<number>;
}

function parseValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export class ReadOnlyViolationError extends Error {
  constructor(command: string) {
    super(`Command "${command}" is not a read command`);
    this.name = "ReadOnlyViolationError";
  }
}

export function assertReadCommand(command: readonly (string | number)[]): void {
  const name = String(command[0] ?? "").toUpperCase();
  if (!(READ_COMMANDS as readonly string[]).includes(name)) throw new ReadOnlyViolationError(name);
}

export type UpstashReaderOptions = {
  url: string;
  /** Must be the read-only token. */
  readOnlyToken: string;
  fetch?: typeof fetch;
  /** Pause between requests (rate friendliness). */
  delayMs?: number;
};

/** Upstash REST reader (the Vercel KV store of the Extras app). */
export class UpstashReadOnlyReader implements KvReader {
  readonly #url: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #delayMs: number;
  /** Commands sent – for the export log and tests (no values). */
  readonly sent: string[] = [];

  constructor(options: UpstashReaderOptions) {
    const url = new URL(options.url);
    if (url.protocol !== "https:") throw new TypeError("KV URL must use https");
    this.#url = url.origin;
    this.#token = options.readOnlyToken;
    this.#fetch = options.fetch ?? fetch;
    this.#delayMs = options.delayMs ?? 0;
  }

  async #command(command: (string | number)[]): Promise<unknown> {
    assertReadCommand(command);
    this.sent.push(String(command[0]).toUpperCase());
    if (this.#delayMs) await new Promise((resolve) => setTimeout(resolve, this.#delayMs));
    const response = await this.#fetch(this.#url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.#token}`, "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    if (!response.ok) throw new Error(`KV request failed with status ${response.status}`);
    const body = (await response.json()) as { result?: unknown; error?: string };
    if (body.error) throw new Error("KV request returned an error");
    return body.result;
  }

  async scan(pattern: string): Promise<string[]> {
    const keys = new Set<string>();
    let cursor = "0";
    let rounds = 0;
    do {
      const result = (await this.#command(["SCAN", cursor, "MATCH", pattern, "COUNT", 500])) as [
        string,
        string[],
      ];
      cursor = result[0];
      for (const key of result[1]) keys.add(key);
      if (++rounds > 10_000) throw new Error("SCAN did not terminate");
    } while (cursor !== "0");
    return [...keys].sort();
  }

  async type(key: string): Promise<KvType> {
    const result = String(await this.#command(["TYPE", key]));
    return (
      ["string", "hash", "list", "set", "zset", "none"].includes(result) ? result : "other"
    ) as KvType;
  }

  async get(key: string): Promise<unknown> {
    return parseValue(await this.#command(["GET", key]));
  }

  async hgetall(key: string): Promise<Record<string, unknown>> {
    const result = await this.#command(["HGETALL", key]);
    const out: Record<string, unknown> = {};
    if (Array.isArray(result)) {
      for (let i = 0; i + 1 < result.length; i += 2)
        out[String(result[i])] = parseValue(result[i + 1]);
    } else if (result && typeof result === "object") {
      for (const [field, value] of Object.entries(result)) out[field] = parseValue(value);
    }
    return out;
  }

  async ttl(key: string): Promise<number> {
    return Number(await this.#command(["TTL", key]));
  }

  async dbsize(): Promise<number> {
    return Number(await this.#command(["DBSIZE"]));
  }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

/**
 * The Extras local fallback (`.data/db.json`): hashes are nested objects, everything else a
 * JSON value. Used for tests and for rehearsing the export without any production access.
 */
export class LocalJsonReader implements KvReader {
  readonly #data: Record<string, unknown>;
  readonly #hashKeys: ReadonlySet<string>;

  constructor(data: Record<string, unknown>) {
    this.#data = data;
    // Keys the Extras code reads with hashGetAll.
    this.#hashKeys = new Set(
      Object.keys(data).filter(
        (key) =>
          /^catalog:[^:]+:items$/.test(key) ||
          key === "requests:items" ||
          key === "stay-extensions:records",
      ),
    );
  }

  scan(pattern: string): Promise<string[]> {
    const regex = globToRegExp(pattern);
    return Promise.resolve(
      Object.keys(this.#data)
        .filter((key) => regex.test(key))
        .sort(),
    );
  }

  type(key: string): Promise<KvType> {
    if (!(key in this.#data)) return Promise.resolve("none");
    return Promise.resolve(this.#hashKeys.has(key) ? "hash" : "string");
  }

  get(key: string): Promise<unknown> {
    return Promise.resolve(this.#data[key] ?? null);
  }

  hgetall(key: string): Promise<Record<string, unknown>> {
    const value = this.#data[key];
    return Promise.resolve(
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {},
    );
  }

  ttl(key: string): Promise<number> {
    return Promise.resolve(key in this.#data ? -1 : -2);
  }

  dbsize(): Promise<number> {
    return Promise.resolve(Object.keys(this.#data).length);
  }
}
