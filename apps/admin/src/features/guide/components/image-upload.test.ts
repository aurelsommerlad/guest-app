import { describe, expect, it } from "vitest";

import { createFakeStorage, PNG, SERVER_KEY } from "../../../testing/fake-storage";
import { type ImageUploadActions, uploadImageFile } from "./image-upload";

const measure = () => Promise.resolve({ width: 1200, height: 800 });
const GRANT_URL =
  "https://abc.supabase.co/storage/v1/object/upload/sign/guide-media/unique-places/hov/guide/123e4567-e89b-42d3-a456-426614174000.png";

function setup(status = 200) {
  const calls: { request: unknown[]; confirm: unknown[]; put: RequestInit[]; urls: string[] } = {
    request: [],
    confirm: [],
    put: [],
    urls: [],
  };
  const actions: ImageUploadActions = {
    request: (file) => {
      calls.request.push(file);
      return Promise.resolve({
        ok: true,
        uploadUrl: `${GRANT_URL}?token=t`,
        path: "unique-places/hov/guide/123e4567-e89b-42d3-a456-426614174000.png",
      });
    },
    confirm: (input) => {
      calls.confirm.push(input);
      return Promise.resolve({
        ok: true,
        image: { src: "https://abc.supabase.co/x.png", width: input.width, height: input.height },
      });
    },
  };
  const fetchFn = ((url: string, init: RequestInit) => {
    calls.urls.push(url);
    calls.put.push(init);
    return Promise.resolve(new Response("{}", { status }));
  }) as unknown as typeof fetch;
  return { calls, actions, fetchFn };
}

describe("browser image upload", () => {
  it("requests a grant, uploads directly to the granted URL, then lets the server confirm", async () => {
    const { calls, actions, fetchFn } = setup();
    const file = new File([PNG], "router.png", { type: "image/png" });
    const result = await uploadImageFile(file, actions, measure, fetchFn);
    expect(result.ok).toBe(true);
    expect(calls.request).toEqual([{ contentType: "image/png", size: PNG.length }]);
    expect(calls.urls).toEqual([`${GRANT_URL}?token=t`]);
    const headers = calls.put[0]?.headers as Record<string, string>;
    expect(calls.put[0]?.method).toBe("PUT");
    expect(headers["content-type"]).toBe("image/png");
    expect(headers["x-upsert"]).toBe("false");
    expect(JSON.stringify(headers)).not.toContain(SERVER_KEY);
    expect(headers["apikey"]).toBeUndefined();
    expect(calls.confirm).toEqual([
      {
        path: "unique-places/hov/guide/123e4567-e89b-42d3-a456-426614174000.png",
        width: 1200,
        height: 800,
      },
    ]);
  });

  it("rejects wrong types and sizes before asking the server", async () => {
    const { calls, actions, fetchFn } = setup();
    for (const file of [
      new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }),
      new File([], "empty.png", { type: "image/png" }),
      new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }),
    ]) {
      expect((await uploadImageFile(file, actions, measure, fetchFn)).ok).toBe(false);
    }
    expect(calls.request).toHaveLength(0);
    expect(calls.urls).toHaveLength(0);
  });

  it("does not confirm when Storage rejects the upload", async () => {
    const { calls, actions, fetchFn } = setup(413);
    const file = new File([PNG], "router.png", { type: "image/png" });
    expect(await uploadImageFile(file, actions, measure, fetchFn)).toEqual({
      ok: false,
      error: "Das Bild ist größer als 8 MB.",
    });
    expect(calls.confirm).toHaveLength(0);
  });

  it("works end to end against Storage semantics", async () => {
    const storage = createFakeStorage();
    const path = "unique-places/hov/guide/123e4567-e89b-42d3-a456-426614174000.png";
    const sign = await storage.fetch(
      `https://abc.supabase.co/storage/v1/object/upload/sign/guide-media/${path}`,
      { method: "POST", headers: { apikey: SERVER_KEY } },
    );
    const { token } = (await sign.json()) as { token: string };
    const actions: ImageUploadActions = {
      request: () =>
        Promise.resolve({
          ok: true,
          uploadUrl: `https://abc.supabase.co/storage/v1/object/upload/sign/guide-media/${path}?token=${token}`,
          path,
        }),
      confirm: ({ width, height }) =>
        Promise.resolve({ ok: true, image: { src: path, width, height } }),
    };
    const file = new File([PNG], "router.png", { type: "image/png" });
    expect((await uploadImageFile(file, actions, measure, storage.fetch)).ok).toBe(true);
    expect(storage.objects.get(path)?.contentType).toBe("image/png");
  });
});
