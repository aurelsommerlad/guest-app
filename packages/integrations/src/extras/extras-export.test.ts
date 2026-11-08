import { describe, expect, it } from "vitest";

import { extrasFixture } from "./fixture";
import { buildInventory, renderInventoryMarkdown } from "./inventory";
import {
  assertReadCommand,
  LocalJsonReader,
  ReadOnlyViolationError,
  UpstashReadOnlyReader,
} from "./kv-reader";
import { exportSnapshot, verifySnapshot } from "./snapshot";

const source = { kind: "local-json" as const, label: "Testdaten (synthetisch)" };
const now = () => new Date("2026-11-08T12:00:00Z");

describe("read-only KV access", () => {
  it("refuses every non-read command before sending anything", () => {
    for (const command of [
      ["SET", "k", "v"],
      ["DEL", "k"],
      ["HSET", "k", "f", "v"],
      ["FLUSHDB"],
      ["EVAL", "x", 0],
      ["KEYS", "*"],
    ]) {
      expect(() => {
        assertReadCommand(command);
      }).toThrow(ReadOnlyViolationError);
    }
    for (const command of [
      ["GET", "k"],
      ["scan", "0"],
      ["HGETALL", "k"],
      ["TYPE", "k"],
      ["TTL", "k"],
      ["DBSIZE"],
    ]) {
      expect(() => {
        assertReadCommand(command);
      }).not.toThrow();
    }
  });

  it("talks to Upstash only via POSTed read commands with the given token", async () => {
    const requests: { url: string; body: unknown; auth: string | null }[] = [];
    const fetchFake: typeof fetch = (input, init) => {
      const body = JSON.parse(init?.body as string) as unknown[];
      requests.push({
        url: input as string,
        body,
        auth: new Headers(init?.headers).get("authorization"),
      });
      const command = String(body[0]);
      const result =
        command === "SCAN"
          ? ["0", ["users"]]
          : command === "TYPE"
            ? "string"
            : command === "GET"
              ? JSON.stringify([{ id: "u1", role: "admin", passwordHash: "x" }])
              : command === "TTL"
                ? -1
                : 1;
      return Promise.resolve(Response.json({ result }));
    };
    const reader = new UpstashReadOnlyReader({
      url: "https://kv.example.test",
      readOnlyToken: "ro-token",
      fetch: fetchFake,
    });
    const { snapshot } = await exportSnapshot(reader, {
      source: { kind: "upstash", label: "Fake" },
      now,
    });
    expect(new Set(reader.sent)).toEqual(new Set(["SCAN", "TYPE", "GET", "DBSIZE"]));
    expect(
      requests.every((r) => r.auth === "Bearer ro-token" && r.url === "https://kv.example.test"),
    ).toBe(true);
    expect(JSON.stringify(snapshot.entries)).not.toContain("passwordHash");
  });

  it("refuses non-https KV URLs", () => {
    expect(
      () => new UpstashReadOnlyReader({ url: "http://kv.example.test", readOnlyToken: "x" }),
    ).toThrow(TypeError);
  });
});

describe("snapshot export", () => {
  it("is repeatable: two runs over unchanged data give identical checksums", async () => {
    const first = await exportSnapshot(new LocalJsonReader(extrasFixture()), { source, now });
    const second = await exportSnapshot(new LocalJsonReader(extrasFixture()), { source, now });
    expect(second.manifest).toEqual(first.manifest);
    expect(verifySnapshot(first.snapshot, first.manifest)).toEqual({ ok: true });
  });

  it("detects changed, missing and extra entries", async () => {
    const { snapshot, manifest } = await exportSnapshot(new LocalJsonReader(extrasFixture()), {
      source,
      now,
    });
    const tampered = structuredClone(snapshot);
    const orders = tampered.entries.find((e) => e.key === "orders");
    const firstOrder = (orders?.value as { id: string }[])[0];
    if (firstOrder) firstOrder.id = "o-x";
    tampered.entries = tampered.entries.filter((e) => e.key !== "users");
    tampered.entries.push({ key: "image:extra", type: "string", value: {} });
    const result = verifySnapshot(tampered, manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toEqual(
        expect.arrayContaining([
          "changed:orders",
          "missing:users",
          "unexpected:image:extra",
          "snapshot-checksum",
        ]),
      );
    }
  });

  it("removes personal data at the source and does not export locks", async () => {
    const { snapshot } = await exportSnapshot(new LocalJsonReader(extrasFixture()), {
      source,
      now,
    });
    const json = JSON.stringify(snapshot.entries);
    for (const secret of ["Erika Gast", "Hans Gast", "erika@example.test", "scrypt$"])
      expect(json).not.toContain(secret);
    expect(snapshot.removedFields).toMatchObject({ guestName: 4, guestEmail: 2, passwordHash: 3 });
    expect(snapshot.entries.map((e) => e.key)).not.toContain("ratelimit:login:1.2.3.4");
    expect(snapshot.ephemeral.map((e) => e.key)).toEqual([
      "dog-booking:claim:ABCDEF-1:ALTUS-HUND",
      "ratelimit:login:1.2.3.4",
    ]);
  });
});

describe("inventory report", () => {
  it("lists volumes, variants and anomalies – without names, e-mail addresses or user names", async () => {
    const { snapshot, manifest } = await exportSnapshot(new LocalJsonReader(extrasFixture()), {
      source,
      now,
    });
    const inventory = buildInventory(snapshot, manifest);
    expect(inventory.catalog.find((c) => c.propertyId === "ALTUS")).toMatchObject({
      items: 4,
      active: 4,
      unitGroupRestricted: 1,
      withImage: 1,
    });
    expect(inventory.sharedServiceCodes).toEqual([
      { code: "EXTRPERSON", properties: 2 },
      { code: "LCO", properties: 2 },
    ]);
    expect(inventory.users).toEqual({ count: 3, roles: { admin: 1, manager: 1, viewer: 1 } });
    expect(inventory.requests).toMatchObject({ count: 2, open: 1 });
    expect(inventory.images).toMatchObject({
      count: 2,
      referenced: 1,
      unreferenced: 1,
      missing: 0,
    });
    expect(inventory.anomalies.join("\n")).toMatch(/HUESLE-EXTRPERSON: Zusatzperson ohne Preis/);
    expect(inventory.anomalies.join("\n")).toMatch(/LAEKE: nur alter Array-Katalog/);
    expect(inventory.anomalies.join("\n")).toMatch(/ohne Ablaufzeit/);

    const report = renderInventoryMarkdown(inventory);
    for (const secret of [
      "Erika",
      "Hans",
      "Mustermann",
      "chefin",
      "@example.test",
      "front",
      "scrypt",
    ])
      expect(report).not.toContain(secret);
    expect(report).toContain(manifest.snapshotSha256);
  });
});
