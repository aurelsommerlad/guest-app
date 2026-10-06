/**
 * GUIDE media in Supabase Storage (ADR 0013), via the official Storage REST API.
 *
 * Upload flow (signed upload):
 *   1. The admin app (server) checks session, tenant, property, type and size, generates the
 *      path itself and asks Storage for a signed upload token for exactly that path
 *      (`POST /storage/v1/object/upload/sign/{bucket}/{path}`, server key; the same call as
 *      supabase-js `createSignedUploadUrl`).
 *   2. The browser uploads the file directly with that token
 *      (`PUT /storage/v1/object/upload/sign/{bucket}/{path}?token=…`, as supabase-js
 *      `uploadToSignedUrl`). The token is bound to the path and never allows overwriting.
 *   3. The server downloads the stored object and verifies size and content type (magic
 *      bytes); anything else is deleted. Saving GUIDE content verifies new images again.
 *
 * The server key never leaves the server. The bucket is public for reads (guest app) and
 * has no write policies; its size and MIME limits are enforced by Storage on every upload.
 *
 * Path: <tenantId>/<propertyId>/guide/<random uuid>.<ext> – generated here, never taken
 * from the browser.
 */
import { randomUUID } from "node:crypto";

import { isEntityKey } from "@up/core";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type ImageType = keyof typeof IMAGE_TYPES;

export function isImageType(value: unknown): value is ImageType {
  return typeof value === "string" && Object.hasOwn(IMAGE_TYPES, value);
}

const SIGNATURES: { type: ImageType; matches: (bytes: Uint8Array) => boolean }[] = [
  { type: "image/jpeg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: "image/png",
    matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    type: "image/webp",
    matches: (b) =>
      String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  },
];

/** Detects the image type from its content (never trusts the file name or browser type). */
export function detectImageType(bytes: Uint8Array): { type: ImageType; ext: string } | undefined {
  const match = SIGNATURES.find((signature) => signature.matches(bytes));
  return match ? { type: match.type, ext: IMAGE_TYPES[match.type] } : undefined;
}

export type MediaStorageConfig = {
  supabaseUrl: string;
  serverKey: string;
  bucket: string;
  fetch?: typeof fetch;
};

export type MediaTarget = { tenantId: string; propertyId: string };

export class MediaStorageError extends Error {
  override name = "MediaStorageError";
  constructor(readonly status: number | undefined) {
    super(`Storage request failed${status ? ` (${String(status)})` : ""}`);
  }
}

const GUIDE_IMAGE_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

function base(config: Pick<MediaStorageConfig, "supabaseUrl">): string {
  return config.supabaseUrl.replace(/\/+$/, "");
}

function serverHeaders(config: MediaStorageConfig): Record<string, string> {
  const headers: Record<string, string> = { apikey: config.serverKey };
  // Legacy service-role keys are JWTs and go in the Authorization header as well.
  if (config.serverKey.startsWith("eyJ")) headers["Authorization"] = `Bearer ${config.serverKey}`;
  return headers;
}

/** A fresh, unguessable object path for one image of this tenant/property. */
export function guideImagePath(target: MediaTarget, type: ImageType): string {
  if (!isEntityKey(target.tenantId) || !isEntityKey(target.propertyId)) {
    throw new Error("invalid media target");
  }
  return `${target.tenantId}/${target.propertyId}/guide/${randomUUID()}.${IMAGE_TYPES[type]}`;
}

/** True only for exactly `<tenantId>/<propertyId>/guide/<uuid>.<ext>` of this target. */
export function isGuideImagePath(path: string, target: MediaTarget): boolean {
  const parts = path.split("/");
  return (
    parts.length === 4 &&
    parts[0] === target.tenantId &&
    parts[1] === target.propertyId &&
    parts[2] === "guide" &&
    GUIDE_IMAGE_FILE.test(parts[3] ?? "") &&
    isEntityKey(target.tenantId) &&
    isEntityKey(target.propertyId)
  );
}

export function publicImageUrl(
  config: Pick<MediaStorageConfig, "supabaseUrl" | "bucket">,
  path: string,
): string {
  return `${base(config)}/storage/v1/object/public/${config.bucket}/${path}`;
}

/** The object path of a public image URL of this target, or undefined for anything else. */
export function guideImagePathFromUrl(
  config: Pick<MediaStorageConfig, "supabaseUrl" | "bucket">,
  src: string,
  target: MediaTarget,
): string | undefined {
  const prefix = publicImageUrl(config, "");
  if (!src.startsWith(prefix)) return undefined;
  const path = src.slice(prefix.length);
  return isGuideImagePath(path, target) ? path : undefined;
}

/**
 * Asks Storage for a signed upload token for exactly `path` (no upsert). Returns the URL the
 * browser uploads to – it contains only the path-bound token, never the server key.
 */
export async function createSignedImageUpload(
  config: MediaStorageConfig,
  path: string,
): Promise<{ uploadUrl: string; path: string }> {
  const objectUrl = `${base(config)}/storage/v1/object/upload/sign/${config.bucket}/${path}`;
  const response = await (config.fetch ?? fetch)(objectUrl, {
    method: "POST",
    headers: { ...serverHeaders(config), "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new MediaStorageError(response.status);
  const data = (await response.json()) as { url?: unknown; token?: unknown };
  const token =
    typeof data.token === "string"
      ? data.token
      : typeof data.url === "string"
        ? new URL(data.url, objectUrl).searchParams.get("token")
        : null;
  if (!token) throw new MediaStorageError(undefined);
  return { uploadUrl: `${objectUrl}?token=${encodeURIComponent(token)}`, path };
}

/** Deletes objects (same call as supabase-js `remove`). */
export async function removeStoredObjects(
  config: MediaStorageConfig,
  paths: string[],
): Promise<void> {
  const response = await (config.fetch ?? fetch)(
    `${base(config)}/storage/v1/object/${config.bucket}`,
    {
      method: "DELETE",
      headers: { ...serverHeaders(config), "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: paths }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new MediaStorageError(response.status);
}

export type StoredImageCheck = "ok" | "missing" | "invalid";

/**
 * Downloads a stored object with the server key and checks that it is a non-empty image of
 * at most 8 MB whose content matches the file extension. Invalid objects are deleted.
 */
export async function verifyStoredImage(
  config: MediaStorageConfig,
  path: string,
): Promise<StoredImageCheck> {
  const response = await (config.fetch ?? fetch)(
    `${base(config)}/storage/v1/object/${config.bucket}/${path}`,
    { headers: serverHeaders(config), signal: AbortSignal.timeout(20_000) },
  );
  if (response.status === 400 || response.status === 404) return "missing";
  if (!response.ok) throw new MediaStorageError(response.status);
  const declared = Number(response.headers.get("content-length"));
  const bytes =
    Number.isFinite(declared) && declared > MAX_IMAGE_BYTES
      ? undefined
      : new Uint8Array(await response.arrayBuffer());
  const detected = bytes ? detectImageType(bytes) : undefined;
  if (
    bytes &&
    bytes.length > 0 &&
    bytes.length <= MAX_IMAGE_BYTES &&
    detected &&
    path.endsWith(`.${detected.ext}`)
  ) {
    return "ok";
  }
  await response.body?.cancel().catch(() => undefined);
  await removeStoredObjects(config, [path]);
  return "invalid";
}
