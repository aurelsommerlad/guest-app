import { describe, expect, it } from "vitest";

import { detectImageType, MediaUploadError, mediaPrefix, uploadGuideImage } from "./media-storage";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const config = {
  supabaseUrl: "https://abc.supabase.co",
  serverKey: "sb_secret_test_key_value",
  bucket: "guide-media",
};

describe("GUIDE media storage", () => {
  it("detects images by content", () => {
    expect(detectImageType(png)).toEqual({ type: "image/png", ext: "png" });
    expect(detectImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeUndefined();
  });

  it("uploads under the tenant/property prefix with the server key and returns the public URL", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = ((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
    const url = await uploadGuideImage(
      { ...config, fetch: fetchFn },
      { tenantId: "unique-places", propertyId: "hov" },
      { bytes: png },
    );
    expect(url.startsWith(mediaPrefix(config, "unique-places", "hov") + "guide/")).toBe(true);
    expect(url).toMatch(/\.png$/);
    expect(calls[0]?.url).toMatch(
      /^https:\/\/abc\.supabase\.co\/storage\/v1\/object\/guide-media\/unique-places\/hov\/guide\/[0-9a-f-]{36}\.png$/,
    );
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers["apikey"]).toBe(config.serverKey);
    expect(headers["Content-Type"]).toBe("image/png");
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("rejects empty, oversized, non-image files and storage failures", async () => {
    const ok = (() => Promise.resolve(new Response("{}"))) as unknown as typeof fetch;
    const target = { tenantId: "unique-places", propertyId: "hov" };
    await expect(
      uploadGuideImage({ ...config, fetch: ok }, target, { bytes: new Uint8Array() }),
    ).rejects.toThrow(MediaUploadError);
    await expect(
      uploadGuideImage({ ...config, fetch: ok }, target, {
        bytes: new Uint8Array(8 * 1024 * 1024 + 1).fill(0xff),
      }),
    ).rejects.toThrow(/too-large|unsupported/);
    await expect(
      uploadGuideImage({ ...config, fetch: ok }, target, {
        bytes: new TextEncoder().encode("hello"),
      }),
    ).rejects.toThrow(/unsupported-type/);
    const failing = (() =>
      Promise.resolve(new Response("no", { status: 403 }))) as unknown as typeof fetch;
    await expect(
      uploadGuideImage({ ...config, fetch: failing }, target, { bytes: png }),
    ).rejects.toThrow(/storage-failed/);
  });
});
