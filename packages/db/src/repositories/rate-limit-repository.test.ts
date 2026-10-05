import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database } from "../client";
import { createTestDatabase, type TestDatabase } from "../testing/test-database";
import { hitRateLimit } from "./rate-limit-repository";

let db: Database;
let client: TestDatabase["client"];
let close: () => Promise<void>;

const WINDOW = 15 * 60 * 1000;
const t0 = new Date("2026-08-29T10:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

beforeAll(async () => {
  ({ db, client, close } = await createTestDatabase());
});

afterAll(async () => {
  await close();
});

describe("hitRateLimit", () => {
  it("counts hits within a window and starts over afterwards", async () => {
    expect((await hitRateLimit(db, "ip:a", WINDOW, t0)).hits).toBe(1);
    expect((await hitRateLimit(db, "ip:a", WINDOW, at(1000))).hits).toBe(2);
    expect((await hitRateLimit(db, "ip:a", WINDOW, at(WINDOW - 1))).hits).toBe(3);
    const fresh = await hitRateLimit(db, "ip:a", WINDOW, at(WINDOW));
    expect(fresh).toEqual({ hits: 1, windowStartedAt: at(WINDOW) });
  });

  it("keeps keys independent", async () => {
    await hitRateLimit(db, "ip:b", WINDOW, t0);
    expect((await hitRateLimit(db, "ip:c", WINDOW, t0)).hits).toBe(1);
  });

  it("counts concurrent hits exactly", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => hitRateLimit(db, "ip:d", WINDOW, t0)),
    );
    expect(results.map((result) => result.hits).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it("prunes buckets older than a day", async () => {
    await hitRateLimit(db, "ip:old", WINDOW, t0);
    await hitRateLimit(db, "ip:new", WINDOW, at(25 * 60 * 60 * 1000));
    const keys = await client.query<{ key: string }>("SELECT key FROM rate_limit_buckets");
    expect(keys.rows.map((row) => row.key)).toEqual(["ip:new"]);
  });

  it("rejects invalid keys", async () => {
    await expect(hitRateLimit(db, "", WINDOW, t0)).rejects.toThrow(TypeError);
  });
});
