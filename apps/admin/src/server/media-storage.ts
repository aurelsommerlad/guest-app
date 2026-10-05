/**
 * GUIDE media in Supabase Storage (ADR 0013) – server-side only, via the Storage REST API
 * with the server key. The browser never sees a Storage key; it only posts the file to a
 * server action.
 *
 * Bucket: public read (guest app renders the images), writes only with the server key.
 * Path:   <tenantId>/<propertyId>/guide/<random uuid>.<ext> – tenant and property bound;
 *         the admin only accepts images under its own tenant/property prefix.
 */
import { randomUUID } from "node:crypto";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const SIGNATURES: { type: string; ext: string; matches: (bytes: Uint8Array) => boolean }[] = [
  {
    type: "image/jpeg",
    ext: "jpg",
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    type: "image/png",
    ext: "png",
    matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    type: "image/webp",
    ext: "webp",
    matches: (b) =>
      String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  },
];

/** Detects the image type from its content (never trusts the file name or browser type). */
export function detectImageType(bytes: Uint8Array): { type: string; ext: string } | undefined {
  const match = SIGNATURES.find((signature) => signature.matches(bytes));
  return match ? { type: match.type, ext: match.ext } : undefined;
}

export type MediaStorageConfig = {
  supabaseUrl: string;
  serverKey: string;
  bucket: string;
  fetch?: typeof fetch;
};

export class MediaUploadError extends Error {
  override name = "MediaUploadError";
  constructor(readonly reason: "too-large" | "unsupported-type" | "empty" | "storage-failed") {
    super(`Upload failed: ${reason}`);
  }
}

export function mediaPrefix(
  config: Pick<MediaStorageConfig, "supabaseUrl" | "bucket">,
  tenantId: string,
  propertyId: string,
): string {
  return `${config.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${config.bucket}/${tenantId}/${propertyId}/`;
}

/** Uploads one image and returns its public URL. */
export async function uploadGuideImage(
  config: MediaStorageConfig,
  target: { tenantId: string; propertyId: string },
  file: { bytes: Uint8Array },
): Promise<string> {
  if (file.bytes.length === 0) throw new MediaUploadError("empty");
  if (file.bytes.length > MAX_IMAGE_BYTES) throw new MediaUploadError("too-large");
  const detected = detectImageType(file.bytes);
  if (!detected) throw new MediaUploadError("unsupported-type");

  const path = `${target.tenantId}/${target.propertyId}/guide/${randomUUID()}.${detected.ext}`;
  const base = config.supabaseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    apikey: config.serverKey,
    "Content-Type": detected.type,
    "Cache-Control": "31536000",
    "x-upsert": "false",
  };
  // Legacy service-role keys are JWTs and go in the Authorization header as well.
  if (config.serverKey.startsWith("eyJ")) headers["Authorization"] = `Bearer ${config.serverKey}`;

  const response = await (config.fetch ?? fetch)(
    `${base}/storage/v1/object/${config.bucket}/${path}`,
    { method: "POST", headers, body: Buffer.from(file.bytes), signal: AbortSignal.timeout(20_000) },
  );
  if (!response.ok) throw new MediaUploadError("storage-failed");
  return `${base}/storage/v1/object/public/${config.bucket}/${path}`;
}
