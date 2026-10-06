import { createLogger } from "@up/core";
import { seedTenant, uniquePlacesSeed } from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isMediaImagePath, mediaImagePath, mediaPathFromUrl } from "../../server/media-storage";
import { createFakeStorage, type FakeStorage, PNG } from "../../testing/fake-storage";
import {
  confirmMediaUpload,
  type MediaUploadDeps,
  requestMediaUpload,
} from "../media/media-upload-service";

const admin = { tenantId: "unique-places", adminUserId: "11111111-1111-4111-8111-111111111111" };
const scope = { tenantId: "unique-places", module: "explore" } as const;
const UUID = "123e4567-e89b-42d3-a456-426614174000";
let test: TestDatabase;
let storage: FakeStorage;
let deps: MediaUploadDeps;

beforeEach(async () => {
  test = await createTestDatabase();
  await seedTenant(test.db, uniquePlacesSeed);
  storage = createFakeStorage();
  deps = {
    db: test.db,
    logger: createLogger({ sink: () => undefined }),
    now: () => new Date("2026-10-10T08:00:00Z"),
    storage: storage.config,
  };
});

afterEach(async () => {
  await test.close();
});

describe("EXPLORE media paths", () => {
  it("uses <tenant>/explore/<uuid>.<ext> and accepts nothing else for this scope", () => {
    expect(mediaImagePath(scope, "image/jpeg")).toMatch(
      /^unique-places\/explore\/[0-9a-f-]{36}\.jpg$/,
    );
    expect(isMediaImagePath(`unique-places/explore/${UUID}.png`, scope)).toBe(true);
    for (const path of [
      `other-tenant/explore/${UUID}.png`,
      `unique-places/hov/guide/${UUID}.png`,
      `unique-places/hov/explore/${UUID}.png`,
      `unique-places/explore/../other-tenant/explore/${UUID}.png`,
      `unique-places/explore/${UUID}.svg`,
    ]) {
      expect(isMediaImagePath(path, scope), path).toBe(false);
    }
    const config = { supabaseUrl: "https://abc.supabase.co", bucket: "guide-media" };
    expect(
      mediaPathFromUrl(
        config,
        `https://abc.supabase.co/storage/v1/object/public/guide-media/unique-places/explore/${UUID}.png`,
        scope,
      ),
    ).toBe(`unique-places/explore/${UUID}.png`);
    expect(
      mediaPathFromUrl(
        config,
        `https://abc.supabase.co/storage/v1/object/public/guide-media/other-tenant/explore/${UUID}.png`,
        scope,
      ),
    ).toBeUndefined();
  });
});

describe("EXPLORE signed upload", () => {
  it("grants, uploads and confirms within the tenant's explore prefix", async () => {
    const grant = await requestMediaUpload(deps, admin, scope, {
      contentType: "image/png",
      size: PNG.length,
    });
    if (!grant.ok) throw new Error(grant.error);
    expect(grant.path).toMatch(/^unique-places\/explore\/[0-9a-f-]{36}\.png$/);
    const put = await storage.fetch(grant.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: PNG.slice(),
    });
    expect(put.status).toBe(200);
    const confirmed = await confirmMediaUpload(deps, admin, scope, {
      path: grant.path,
      width: 10,
      height: 10,
    });
    expect(confirmed).toMatchObject({ ok: true, image: { width: 10, height: 10 } });
  });

  it("refuses scopes of another tenant and paths outside the scope", async () => {
    expect(
      await requestMediaUpload(
        deps,
        admin,
        { tenantId: "other-tenant", module: "explore" },
        { contentType: "image/png", size: 10 },
      ),
    ).toMatchObject({ ok: false });
    storage.put(`unique-places/hov/guide/${UUID}.png`, PNG);
    expect(
      await confirmMediaUpload(deps, admin, scope, {
        path: `unique-places/hov/guide/${UUID}.png`,
        width: 1,
        height: 1,
      }),
    ).toMatchObject({ ok: false, error: "Ungültiger Upload." });
    expect(storage.requests).toHaveLength(0);
  });
});
