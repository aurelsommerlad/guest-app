import { createLogger } from "@up/core";
import { type Database, seedTenant, uniquePlacesSeed } from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAX_IMAGE_BYTES } from "../../server/media-storage";
import {
  createFakeStorage,
  type FakeStorage,
  JPEG,
  PNG,
  SERVER_KEY,
} from "../../testing/fake-storage";
import {
  confirmImageUpload,
  type GuideMediaDeps,
  requestImageUpload,
  UPLOAD_GRANT_LIMIT,
} from "./guide-media-service";

const admin = { tenantId: "unique-places", adminUserId: "11111111-1111-4111-8111-111111111111" };
const UUID = "123e4567-e89b-42d3-a456-426614174000";
let test: TestDatabase;
let db: Database;
let storage: FakeStorage;
let logs: string[];
let deps: GuideMediaDeps;

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  await seedTenant(db, uniquePlacesSeed);
  await seedTenant(db, {
    tenant: { id: "other-tenant", slug: "other-tenant", name: "Other" },
    properties: [
      {
        id: "other-hov",
        slug: "hov",
        displayName: "Other",
        spokenName: "Other",
        locationName: "Ort",
        timezone: "Europe/Berlin",
      },
    ],
  });
  storage = createFakeStorage();
  logs = [];
  deps = {
    db,
    logger: createLogger({ level: "debug", sink: (_level, line) => logs.push(line) }),
    now: () => new Date("2026-10-10T08:00:00Z"),
    storage: storage.config,
  };
});

afterEach(async () => {
  await test.close();
});

/** The browser part: upload with the grant exactly like the editor does. */
async function browserUpload(uploadUrl: string, bytes: Uint8Array, type = "image/png") {
  return storage.fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": type, "x-upsert": "false" },
    body: bytes.slice(),
  });
}

describe("signed GUIDE image upload", () => {
  it("grants one generated path of the admin's tenant/property and verifies the stored file", async () => {
    const grant = await requestImageUpload(deps, admin, "hov", {
      contentType: "image/png",
      size: PNG.length,
    });
    if (!grant.ok) throw new Error(grant.error);
    expect(grant.path).toMatch(/^unique-places\/hov\/guide\/[0-9a-f-]{36}\.png$/);
    expect(JSON.stringify(grant)).not.toContain(SERVER_KEY);
    expect((await browserUpload(grant.uploadUrl, PNG)).status).toBe(200);

    const confirmed = await confirmImageUpload(deps, admin, "hov", {
      path: grant.path,
      width: 1200,
      height: 800,
    });
    expect(confirmed).toEqual({
      ok: true,
      image: {
        src: `https://abc.supabase.co/storage/v1/object/public/guide-media/${grant.path}`,
        width: 1200,
        height: 800,
      },
    });
  });

  it("issues no grant for other tenants' or unknown properties", async () => {
    for (const propertyId of ["other-hov", "unknown", "../other-tenant", 42]) {
      const result = await requestImageUpload(deps, admin, propertyId, {
        contentType: "image/png",
        size: 10,
      });
      expect(result).toEqual({ ok: false, error: "Objekt nicht gefunden." });
    }
    expect(storage.requests).toHaveLength(0);
  });

  it("checks type and size before contacting Storage", async () => {
    const invalid: { contentType: unknown; size: unknown }[] = [
      { contentType: "image/svg+xml", size: 10 },
      { contentType: "text/html", size: 10 },
      { contentType: "image/gif", size: 10 },
      { contentType: undefined, size: 10 },
      { contentType: "image/png", size: 0 },
      { contentType: "image/png", size: 1.5 },
      { contentType: "image/png", size: "10" },
      { contentType: "image/png", size: MAX_IMAGE_BYTES + 1 },
    ];
    for (const file of invalid) {
      expect((await requestImageUpload(deps, admin, "hov", file)).ok).toBe(false);
    }
    expect(storage.requests).toHaveLength(0);
    expect(
      (
        await requestImageUpload(deps, admin, "hov", {
          contentType: "image/png",
          size: MAX_IMAGE_BYTES,
        })
      ).ok,
    ).toBe(true);
  });

  it("never takes the path from the browser", async () => {
    const grant = await requestImageUpload(deps, admin, "hov", {
      contentType: "image/jpeg",
      size: 10,
      // Extra fields from a manipulated client are ignored.
      ...{ path: "other-tenant/hov/guide/evil.jpg" },
    });
    if (!grant.ok) throw new Error(grant.error);
    expect(grant.path).toMatch(/^unique-places\/hov\/guide\/[0-9a-f-]{36}\.jpg$/);
    expect(storage.requests[0]?.url).toContain(`/upload/sign/guide-media/${grant.path}`);
  });

  it("the grant cannot be used for another path or to overwrite", async () => {
    const grant = await requestImageUpload(deps, admin, "hov", {
      contentType: "image/png",
      size: PNG.length,
    });
    if (!grant.ok) throw new Error(grant.error);
    const token = new URL(grant.uploadUrl).searchParams.get("token") ?? "";
    const foreign = `https://abc.supabase.co/storage/v1/object/upload/sign/guide-media/other-tenant/other-hov/guide/${UUID}.png?token=${token}`;
    expect((await browserUpload(foreign, PNG)).status).toBe(400);
    expect((await browserUpload(grant.uploadUrl, PNG)).status).toBe(200);
    expect((await browserUpload(grant.uploadUrl, JPEG, "image/jpeg")).status).toBe(409);
  });

  it("confirms only paths of the admin's tenant/property", async () => {
    storage.put(`other-tenant/other-hov/guide/${UUID}.png`, PNG);
    for (const [propertyId, path] of [
      ["hov", `other-tenant/other-hov/guide/${UUID}.png`],
      ["hov", `unique-places/ros/guide/${UUID}.png`],
      ["hov", `unique-places/hov/guide/../../../other-tenant/other-hov/guide/${UUID}.png`],
      ["other-hov", `other-tenant/other-hov/guide/${UUID}.png`],
    ] as const) {
      const result = await confirmImageUpload(deps, admin, propertyId, {
        path,
        width: 10,
        height: 10,
      });
      expect(result.ok).toBe(false);
    }
    expect(storage.requests).toHaveLength(0);
    expect(storage.objects.size).toBe(1);
  });

  it("rejects missing uploads and deletes files that are not the granted image type", async () => {
    const grant = await requestImageUpload(deps, admin, "hov", {
      contentType: "image/png",
      size: 32,
    });
    if (!grant.ok) throw new Error(grant.error);
    const input = { path: grant.path, width: 10, height: 10 };
    expect(await confirmImageUpload(deps, admin, "hov", input)).toEqual({
      ok: false,
      error: "Das Bild wurde nicht hochgeladen.",
    });
    // Declared as PNG (passes the bucket MIME check), but the content is HTML.
    await browserUpload(grant.uploadUrl, new TextEncoder().encode("<html><script>x</script>"));
    expect((await confirmImageUpload(deps, admin, "hov", input)).ok).toBe(false);
    expect(storage.objects.has(grant.path)).toBe(false);
    expect((await confirmImageUpload(deps, admin, "hov", { ...input, width: 0 })).ok).toBe(false);
  });

  it("rate-limits grants per admin account", async () => {
    const file = { contentType: "image/png", size: 10 };
    for (let i = 0; i < UPLOAD_GRANT_LIMIT.max; i++) {
      expect((await requestImageUpload(deps, admin, "hov", file)).ok).toBe(true);
    }
    expect(await requestImageUpload(deps, admin, "hov", file)).toEqual({
      ok: false,
      error: "Zu viele Uploads. Bitte versuche es in einigen Minuten erneut.",
    });
    const colleague = { ...admin, adminUserId: "22222222-2222-4222-8222-222222222222" };
    expect((await requestImageUpload(deps, colleague, "hov", file)).ok).toBe(true);
  });

  it("fails closed on Storage errors and never logs keys, tokens or upload URLs", async () => {
    storage.failNextRequest();
    expect(
      await requestImageUpload(deps, admin, "hov", { contentType: "image/png", size: 10 }),
    ).toEqual({ ok: false, error: "Der Upload konnte nicht vorbereitet werden." });
    const grant = await requestImageUpload(deps, admin, "hov", {
      contentType: "image/png",
      size: 10,
    });
    if (!grant.ok) throw new Error(grant.error);
    const token = new URL(grant.uploadUrl).searchParams.get("token") ?? "";
    const output = logs.join("\n");
    expect(output).toContain("guide image upload granted");
    expect(output).not.toContain(SERVER_KEY);
    expect(output).not.toContain(token);
    expect(output).not.toContain("upload/sign");
  });
});
