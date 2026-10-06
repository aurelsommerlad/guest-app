/**
 * In-memory stand-in for the Supabase Storage routes the admin uses (tests only):
 * signed upload tokens bound to one path, no overwrite, bucket size/MIME limits, server key
 * required for signing, reading and deleting.
 */
import { randomUUID } from "node:crypto";

export const SERVER_KEY = "sb_secret_test_server_key_value";
export const SUPABASE_URL = "https://abc.supabase.co";
export const BUCKET = "guide-media";

const BUCKET_LIMIT = 8 * 1024 * 1024;
const BUCKET_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type FakeStorage = ReturnType<typeof createFakeStorage>;

export function createFakeStorage() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const tokens = new Map<string, string>();
  const requests: { method: string; url: string; headers: Record<string, string> }[] = [];
  let failNext = false;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    requests.push({ method, url: url.toString(), headers });
    if (failNext) {
      failNext = false;
      return json({ error: "unavailable" }, 503);
    }
    const isServer = headers["apikey"] === SERVER_KEY;
    const signPrefix = `/storage/v1/object/upload/sign/${BUCKET}/`;
    const objectPrefix = `/storage/v1/object/${BUCKET}/`;

    if (url.pathname.startsWith(signPrefix)) {
      const path = decodeURIComponent(url.pathname.slice(signPrefix.length));
      if (method === "POST") {
        if (!isServer) return json({ error: "Unauthorized" }, 403);
        const token = randomUUID();
        tokens.set(token, path);
        return json({ url: `/object/upload/sign/${BUCKET}/${path}?token=${token}`, token });
      }
      if (method === "PUT") {
        const token = url.searchParams.get("token") ?? "";
        if (tokens.get(token) !== path) return json({ error: "InvalidSignature" }, 400);
        if (objects.has(path)) return json({ error: "Duplicate" }, 409);
        const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer());
        const contentType = headers["content-type"] ?? "application/octet-stream";
        if (bytes.length > BUCKET_LIMIT) return json({ error: "Payload too large" }, 413);
        if (!BUCKET_TYPES.has(contentType)) return json({ error: "invalid_mime_type" }, 415);
        objects.set(path, { bytes, contentType });
        return json({ Key: `${BUCKET}/${path}` });
      }
    }
    if (method === "DELETE" && url.pathname === `/storage/v1/object/${BUCKET}`) {
      if (!isServer) return json({ error: "Unauthorized" }, 403);
      const { prefixes } = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
        prefixes: string[];
      };
      for (const path of prefixes) objects.delete(path);
      return json([]);
    }
    if (method === "GET" && url.pathname.startsWith(objectPrefix)) {
      if (!isServer) return json({ error: "Unauthorized" }, 403);
      const stored = objects.get(decodeURIComponent(url.pathname.slice(objectPrefix.length)));
      if (!stored) return json({ statusCode: "404", error: "not_found" }, 400);
      return new Response(stored.bytes.slice(), {
        headers: {
          "content-type": stored.contentType,
          "content-length": String(stored.bytes.length),
        },
      });
    }
    return json({ error: "unexpected request" }, 500);
  }) as typeof fetch;

  return {
    fetch: fetchFn,
    objects,
    requests,
    config: { supabaseUrl: SUPABASE_URL, serverKey: SERVER_KEY, bucket: BUCKET, fetch: fetchFn },
    /** Simulates an object written by someone else (e.g. bypassing the editor). */
    put(path: string, bytes: Uint8Array, contentType = "image/png") {
      objects.set(path, { bytes, contentType });
    },
    failNextRequest() {
      failNext = true;
    },
  };
}

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
