/**
 * Image migration Extras → STAY (prepared in M3, run with the go-live sync).
 *
 * Extras stores uploaded images as base64 in KV (`image:<uuid>` → { contentType, base64 }) and
 * references them from catalog items as `/api/images/<uuid>`. The plan lists every image with
 * SHA-256, byte size, real type and dimensions read from the file header, and every catalog
 * item that uses it. Applying uploads each referenced image once (checksum-addressed) through
 * an injected uploader (the admin's storage area `offers`) and sets it as hero image only where
 * STAY has none yet – editorial images in STAY are never replaced.
 */
import { createHash } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { type Database } from "../client";
import { offerProperties, offers } from "../schema";
import { type ExtrasSnapshotLike } from "./importer";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};

export type ImageInfo = {
  type: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
};

/** Type and dimensions from the file header (PNG IHDR, JPEG SOFn, WebP VP8/VP8L/VP8X). */
export function readImageHeader(bytes: Uint8Array): ImageInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(1, 3) === "PNG" && ascii(12, 4) === "IHDR")
    return { type: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1] ?? 0;
      const length = view.getUint16(offset + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof)
        return {
          type: "image/jpeg",
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7),
        };
      offset += 2 + length;
    }
    return null;
  }
  if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 ")
      return {
        type: "image/webp",
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    if (chunk === "VP8L") {
      const b = view.getUint32(21, true);
      return { type: "image/webp", width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
      const w = (bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16);
      const h = (bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16);
      return { type: "image/webp", width: w + 1, height: h + 1 };
    }
  }
  return null;
}

export type PlannedImage = {
  imageId: string;
  sha256: string | null;
  bytes: number;
  storedContentType: string | null;
  info: ImageInfo | null;
  /** Catalog items (`<apaleoPropertyId>:<serviceId>`) that reference the image. */
  references: string[];
  issues: ("missing_image" | "unreadable" | "type_mismatch" | "unreferenced" | "too_large")[];
};

const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_URL = /\/api\/images\/([0-9a-f-]{36})/i;

export function planImageMigration(snapshot: ExtrasSnapshotLike): PlannedImage[] {
  const stored = new Map<string, Obj>();
  for (const entry of snapshot.entries) {
    const match = /^image:([0-9a-f-]{36})$/i.exec(entry.key);
    if (match?.[1]) stored.set(match[1].toLowerCase(), obj(entry.value));
  }
  const references = new Map<string, Set<string>>();
  for (const entry of snapshot.entries) {
    const match = /^catalog:([^:]+):items$/.exec(entry.key);
    if (!match?.[1]) continue;
    for (const item of Object.values(obj(entry.value)).map(obj)) {
      const id = typeof item.imageUrl === "string" ? IMAGE_URL.exec(item.imageUrl)?.[1] : undefined;
      if (!id) continue;
      const key = id.toLowerCase();
      if (!references.has(key)) references.set(key, new Set());
      references.get(key)?.add(`${match[1]}:${String(item.serviceId)}`);
    }
  }
  const ids = [...new Set([...stored.keys(), ...references.keys()])].sort();
  return ids.map((imageId) => {
    const value = stored.get(imageId);
    const issues: PlannedImage["issues"] = [];
    const refs = [...(references.get(imageId) ?? [])].sort();
    if (!refs.length) issues.push("unreferenced");
    if (!value) {
      issues.push("missing_image");
      return {
        imageId,
        sha256: null,
        bytes: 0,
        storedContentType: null,
        info: null,
        references: refs,
        issues,
      };
    }
    const bytes =
      typeof value.base64 === "string" ? Buffer.from(value.base64, "base64") : Buffer.alloc(0);
    const info = readImageHeader(bytes);
    if (!info) issues.push("unreadable");
    const storedType = typeof value.contentType === "string" ? value.contentType : null;
    if (info && storedType && storedType.replace("image/jpg", "image/jpeg") !== info.type)
      issues.push("type_mismatch");
    if (bytes.length > MAX_BYTES) issues.push("too_large");
    return {
      imageId,
      sha256: bytes.length ? createHash("sha256").update(bytes).digest("hex") : null,
      bytes: bytes.length,
      storedContentType: storedType,
      info,
      references: refs,
      issues,
    };
  });
}

export type ImageUploader = (input: {
  bytes: Uint8Array;
  info: ImageInfo;
  sha256: string;
}) => Promise<{ src: string }>;

export type ImageApplyResult = {
  uploaded: number;
  heroImagesSet: { reference: string; offerId: string; target: "offer" | "property" }[];
  skipped: { reference: string; reason: string }[];
};

/**
 * Uploads the referenced, readable images and attaches them where STAY has no image yet:
 * the offer's hero image, or – if the offer already has another image – the property override.
 */
export async function applyImageMigration(
  db: Database,
  context: { tenantId: string },
  snapshot: ExtrasSnapshotLike,
  plan: readonly PlannedImage[],
  upload: ImageUploader,
): Promise<ImageApplyResult> {
  const result: ImageApplyResult = { uploaded: 0, heroImagesSet: [], skipped: [] };
  const bytesOf = new Map<string, Buffer>();
  for (const entry of snapshot.entries) {
    const match = /^image:([0-9a-f-]{36})$/i.exec(entry.key);
    const value = obj(entry.value);
    if (match?.[1] && typeof value.base64 === "string")
      bytesOf.set(match[1].toLowerCase(), Buffer.from(value.base64, "base64"));
  }
  for (const image of plan) {
    const blocking = image.issues.filter((i) => i !== "type_mismatch");
    if (!image.references.length) continue;
    if (blocking.length || !image.info || !image.sha256) {
      for (const reference of image.references)
        result.skipped.push({ reference, reason: blocking.join(",") || "unreadable" });
      continue;
    }
    const bytes = bytesOf.get(image.imageId);
    if (!bytes) continue;
    const { src } = await upload({ bytes, info: image.info, sha256: image.sha256 });
    result.uploaded += 1;
    const content = { src, width: image.info.width, height: image.info.height, alt: { de: "" } };
    for (const reference of image.references) {
      const [config] = await db
        .select({
          offerId: offerProperties.offerId,
          propertyId: offerProperties.propertyId,
          override: offerProperties.heroImageOverride,
        })
        .from(offerProperties)
        .where(
          and(
            eq(offerProperties.tenantId, context.tenantId),
            eq(offerProperties.legacyKey, reference),
          ),
        );
      if (!config) {
        result.skipped.push({ reference, reason: "catalog_item_not_imported" });
        continue;
      }
      const [offer] = await db
        .update(offers)
        .set({ heroImage: content })
        .where(
          and(
            eq(offers.tenantId, context.tenantId),
            eq(offers.id, config.offerId),
            isNull(offers.heroImage),
          ),
        )
        .returning({ id: offers.id });
      if (offer) {
        result.heroImagesSet.push({ reference, offerId: config.offerId, target: "offer" });
        continue;
      }
      const [current] = await db
        .select({ hero: offers.heroImage })
        .from(offers)
        .where(and(eq(offers.tenantId, context.tenantId), eq(offers.id, config.offerId)));
      if (current?.hero?.src === src) {
        result.skipped.push({ reference, reason: "already_set" });
      } else if (!config.override) {
        await db
          .update(offerProperties)
          .set({ heroImageOverride: content })
          .where(
            and(
              eq(offerProperties.tenantId, context.tenantId),
              eq(offerProperties.offerId, config.offerId),
              eq(offerProperties.propertyId, config.propertyId),
            ),
          );
        result.heroImagesSet.push({ reference, offerId: config.offerId, target: "property" });
      } else {
        result.skipped.push({ reference, reason: "stay_image_kept" });
      }
    }
  }
  return result;
}
