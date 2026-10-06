import { describe, expect, it } from "vitest";

import {
  BUCKET,
  createFakeStorage,
  JPEG,
  PNG,
  SERVER_KEY,
  SUPABASE_URL,
} from "../testing/fake-storage";
import {
  createSignedImageUpload,
  detectImageType,
  guideImagePath,
  guideImagePathFromUrl,
  isGuideImagePath,
  MAX_IMAGE_BYTES,
  MediaStorageError,
  publicImageUrl,
  verifyStoredImage,
} from "./media-storage";

const target = { tenantId: "unique-places", propertyId: "hov" };
const UUID = "123e4567-e89b-42d3-a456-426614174000";
const own = `unique-places/hov/guide/${UUID}.png`;

describe("GUIDE media paths", () => {
  it("detects images by content", () => {
    expect(detectImageType(PNG)).toEqual({ type: "image/png", ext: "png" });
    expect(detectImageType(JPEG)).toEqual({ type: "image/jpeg", ext: "jpg" });
    expect(detectImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeUndefined();
  });

  it("generates unguessable paths under tenant/property/guide", () => {
    const first = guideImagePath(target, "image/webp");
    const second = guideImagePath(target, "image/webp");
    expect(first).toMatch(/^unique-places\/hov\/guide\/[0-9a-f-]{36}\.webp$/);
    expect(first).not.toBe(second);
    expect(isGuideImagePath(first, target)).toBe(true);
    expect(() => guideImagePath({ tenantId: "../x", propertyId: "hov" }, "image/png")).toThrow();
  });

  it("accepts only exactly the target's guide image paths", () => {
    expect(isGuideImagePath(own, target)).toBe(true);
    for (const path of [
      `other-tenant/hov/guide/${UUID}.png`,
      `unique-places/ros/guide/${UUID}.png`,
      `unique-places/hov/other/${UUID}.png`,
      `unique-places/hov/guide/../../../other-tenant/hov/guide/${UUID}.png`,
      `unique-places/hov/guide/x/${UUID}.png`,
      `unique-places/hov/guide/${UUID}.svg`,
      `unique-places/hov/guide/${UUID}.png?x=1`,
      `unique-places/hov/guide/evil.png`,
      `/unique-places/hov/guide/${UUID}.png`,
    ]) {
      expect(isGuideImagePath(path, target)).toBe(false);
    }
  });

  it("maps public URLs back to paths only for the own bucket, tenant and property", () => {
    const config = { supabaseUrl: SUPABASE_URL, bucket: BUCKET };
    expect(guideImagePathFromUrl(config, publicImageUrl(config, own), target)).toBe(own);
    for (const src of [
      `https://evil.example/storage/v1/object/public/${BUCKET}/${own}`,
      `${SUPABASE_URL}/storage/v1/object/public/other-bucket/${own}`,
      `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/unique-places/hov/../../other-tenant/hov/guide/${UUID}.png`,
      `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/other-tenant/hov/guide/${UUID}.png`,
      `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${own}`,
    ]) {
      expect(guideImagePathFromUrl(config, src, target)).toBeUndefined();
    }
  });
});

describe("signed upload", () => {
  it("signs exactly one path with the server key; the upload URL carries only the token", async () => {
    const storage = createFakeStorage();
    const { uploadUrl, path } = await createSignedImageUpload(storage.config, own);
    expect(path).toBe(own);
    const signCall = storage.requests[0];
    expect(signCall?.method).toBe("POST");
    expect(signCall?.url).toBe(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${own}`);
    expect(signCall?.headers["apikey"]).toBe(SERVER_KEY);
    expect(signCall?.headers["x-upsert"]).toBeUndefined();
    expect(uploadUrl).toMatch(
      new RegExp(`^${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${own}\\?token=[^&]+$`),
    );
    expect(uploadUrl).not.toContain(SERVER_KEY);
  });

  it("the token works only for its own path, only once and within the bucket limits", async () => {
    const storage = createFakeStorage();
    const { uploadUrl } = await createSignedImageUpload(storage.config, own);
    const token = new URL(uploadUrl).searchParams.get("token") ?? "";
    const put = (url: string, body: Uint8Array, type = "image/png") =>
      storage.fetch(url, { method: "PUT", headers: { "content-type": type }, body: body.slice() });

    const otherPath = `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/other-tenant/hov/guide/${UUID}.png?token=${token}`;
    expect((await put(otherPath, PNG)).status).toBe(400);
    expect((await put(uploadUrl, PNG, "text/html")).status).toBe(415);
    expect((await put(uploadUrl, new Uint8Array(MAX_IMAGE_BYTES + 1))).status).toBe(413);
    expect((await put(uploadUrl, PNG)).status).toBe(200);
    expect((await put(uploadUrl, JPEG)).status).toBe(409); // no overwrite
    expect([...storage.objects.keys()]).toEqual([own]);
  });

  it("also reads the token from the returned URL and fails closed on Storage errors", async () => {
    const urlOnly = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ url: `/object/upload/sign/${BUCKET}/${own}?token=abc` })),
      )) as unknown as typeof fetch;
    const result = await createSignedImageUpload(
      { supabaseUrl: SUPABASE_URL, serverKey: SERVER_KEY, bucket: BUCKET, fetch: urlOnly },
      own,
    );
    expect(result.uploadUrl.endsWith("?token=abc")).toBe(true);

    const storage = createFakeStorage();
    storage.failNextRequest();
    await expect(createSignedImageUpload(storage.config, own)).rejects.toThrow(MediaStorageError);
    const noToken = (() => Promise.resolve(new Response("{}"))) as unknown as typeof fetch;
    await expect(
      createSignedImageUpload(
        { supabaseUrl: SUPABASE_URL, serverKey: SERVER_KEY, bucket: BUCKET, fetch: noToken },
        own,
      ),
    ).rejects.toThrow(MediaStorageError);
  });
});

describe("stored image verification", () => {
  it("accepts a stored image whose content matches its extension", async () => {
    const storage = createFakeStorage();
    storage.put(own, PNG);
    expect(await verifyStoredImage(storage.config, own)).toBe("ok");
    expect(storage.objects.has(own)).toBe(true);
  });

  it("reports missing uploads", async () => {
    const storage = createFakeStorage();
    expect(await verifyStoredImage(storage.config, own)).toBe("missing");
  });

  it("deletes non-images, mismatching content and oversized files", async () => {
    const storage = createFakeStorage();
    const jpgPath = `unique-places/hov/guide/${UUID}.jpg`;
    const cases: [string, Uint8Array][] = [
      [own, new TextEncoder().encode("<html><script>alert(1)</script>")],
      [jpgPath, PNG],
      [own, new Uint8Array(0)],
    ];
    for (const [path, bytes] of cases) {
      storage.put(path, bytes);
      expect(await verifyStoredImage(storage.config, path)).toBe("invalid");
      expect(storage.objects.has(path)).toBe(false);
    }
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG);
    storage.put(own, big);
    expect(await verifyStoredImage(storage.config, own)).toBe("invalid");
    expect(storage.objects.has(own)).toBe(false);
  });
});
