import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedTenant } from "../seed/seed-tenant";
import { uniquePlacesSeed } from "../seed/unique-places";
import { createTestDatabase, type TestDatabase } from "../testing/test-database";
import { applyImageMigration, planImageMigration, readImageHeader } from "./images";
import { importExtrasSnapshot } from "./importer";

function png(width: number, height: number) {
  const b = Buffer.alloc(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 0);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}
function jpeg(width: number, height: number) {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    0x03,
    0,
    0,
    0,
    0,
  ]);
}
function webpVp8x(width: number, height: number) {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "ascii");
  b.write("WEBP", 8, "ascii");
  b.write("VP8X", 12, "ascii");
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

const IMG_A = "11111111-1111-4111-8111-111111111111";
const IMG_B = "22222222-2222-4222-8222-222222222222";
const IMG_C = "33333333-3333-4333-8333-333333333333";
const snapshot = {
  entries: [
    {
      key: "catalog:TEST:items",
      type: "hash",
      value: {
        "TEST-HUND": {
          serviceId: "TEST-HUND",
          code: "HUND",
          active: true,
          displayNameDe: "Hund",
          bookingRule: "per_night",
          imageUrl: `/api/images/${IMG_A}`,
        },
        "TEST-PKW": {
          serviceId: "TEST-PKW",
          code: "PKW",
          active: true,
          displayNameDe: "Parkplatz",
          bookingRule: "per_night",
          imageUrl: `https://extras.example/api/images/${IMG_C}`,
        },
      },
    },
    {
      key: `image:${IMG_A}`,
      type: "string",
      value: { contentType: "image/jpeg", base64: png(1200, 800).toString("base64") },
    },
    {
      key: `image:${IMG_B}`,
      type: "string",
      value: { contentType: "image/webp", base64: webpVp8x(640, 480).toString("base64") },
    },
  ],
};

let test: TestDatabase;
beforeAll(async () => {
  test = await createTestDatabase();
  await seedTenant(test.db, uniquePlacesSeed);
  await test.client.query(
    `INSERT INTO properties (id, tenant_id, slug, display_name, spoken_name, location_name, timezone)
     VALUES ('test-run', 'unique-places', 'test-run', 'Test run', 'Test run', 'Test', 'Europe/Berlin')`,
  );
  await test.client.query(
    `INSERT INTO external_mappings (tenant_id, provider, entity_type, internal_entity_id, external_id)
     VALUES ('unique-places', 'apaleo', 'property', 'test-run', 'TEST')`,
  );
});
afterAll(async () => {
  await test.close();
});

describe("image migration", () => {
  it("reads type and dimensions from PNG, JPEG and WebP headers", () => {
    expect(readImageHeader(png(1200, 800))).toEqual({
      type: "image/png",
      width: 1200,
      height: 800,
    });
    expect(readImageHeader(jpeg(640, 427))).toEqual({
      type: "image/jpeg",
      width: 640,
      height: 427,
    });
    expect(readImageHeader(webpVp8x(640, 480))).toEqual({
      type: "image/webp",
      width: 640,
      height: 480,
    });
    expect(readImageHeader(Buffer.from("no image"))).toBeNull();
  });

  it("plans every image with checksum, references and issues", () => {
    const plan = planImageMigration(snapshot);
    expect(plan.map((p) => [p.imageId, p.references, p.issues])).toEqual([
      [IMG_A, ["TEST:TEST-HUND"], ["type_mismatch"]],
      [IMG_B, [], ["unreferenced"]],
      [IMG_C, ["TEST:TEST-PKW"], ["missing_image"]],
    ]);
    expect(plan[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(plan[0]?.info).toEqual({ type: "image/png", width: 1200, height: 800 });
  });

  it("uploads referenced images once and only fills empty hero images", async () => {
    await importExtrasSnapshot(test.db, { tenantId: "unique-places" }, snapshot, {
      mode: "apply",
      snapshotSha256: "0".repeat(64),
      actorAdminId: null,
      now: new Date("2026-11-08T10:00:00Z"),
    });
    const uploads: string[] = [];
    const upload = ({ sha256 }: { sha256: string }) => {
      uploads.push(sha256);
      return Promise.resolve({ src: `https://storage.example/offers/${sha256}.png` });
    };
    const plan = planImageMigration(snapshot);
    const first = await applyImageMigration(
      test.db,
      { tenantId: "unique-places" },
      snapshot,
      plan,
      upload,
    );
    expect(first.uploaded).toBe(1);
    expect(first.heroImagesSet).toMatchObject([{ reference: "TEST:TEST-HUND", target: "offer" }]);
    expect(first.skipped).toEqual([{ reference: "TEST:TEST-PKW", reason: "missing_image" }]);
    const second = await applyImageMigration(
      test.db,
      { tenantId: "unique-places" },
      snapshot,
      plan,
      upload,
    );
    expect(second.heroImagesSet).toEqual([]);
    expect(second.skipped).toContainEqual({ reference: "TEST:TEST-HUND", reason: "already_set" });
    const rows = await test.client.query<{ hero_image: { width: number } }>(
      `SELECT hero_image FROM offers WHERE legacy_key = 'extras:HUND'`,
    );
    expect(rows.rows[0]?.hero_image.width).toBe(1200);
  });
});
