/**
 * GUIDE image uploads (ADR 0013): the server issues a signed upload for one generated path
 * and verifies the stored file afterwards. Every step runs with the admin session's tenant.
 */
import { type Logger, type TenantContext } from "@up/core";
import { type Database, getPropertyById, hitRateLimit } from "@up/db";

import {
  createSignedImageUpload,
  guideImagePath,
  isGuideImagePath,
  isImageType,
  MAX_IMAGE_BYTES,
  type MediaStorageConfig,
  type MediaTarget,
  publicImageUrl,
  verifyStoredImage,
} from "../../server/media-storage";
import { type Result } from "./guide-admin-service";

export type GuideMediaDeps = {
  db: Database;
  logger: Logger;
  now: () => Date;
  storage: MediaStorageConfig;
};

export type MediaAdmin = TenantContext & { adminUserId: string };

/** Upload grants per admin account: generous for editing, bounded against abuse. */
export const UPLOAD_GRANT_LIMIT = { windowMs: 15 * 60 * 1000, max: 60 } as const;

const MAX_DIMENSION = 20_000;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

async function targetFor(
  deps: GuideMediaDeps,
  admin: MediaAdmin,
  propertyId: unknown,
): Promise<MediaTarget | undefined> {
  if (typeof propertyId !== "string") return undefined;
  const property = await getPropertyById(deps.db, { tenantId: admin.tenantId }, propertyId);
  return property ? { tenantId: admin.tenantId, propertyId: property.id } : undefined;
}

/** Step 1: checks and a signed upload for exactly one freshly generated path. */
export async function requestImageUpload(
  deps: GuideMediaDeps,
  admin: MediaAdmin,
  propertyId: unknown,
  file: { contentType: unknown; size: unknown },
): Promise<Result<{ uploadUrl: string; path: string }>> {
  const target = await targetFor(deps, admin, propertyId);
  if (!target) return fail("Objekt nicht gefunden.");
  if (!isImageType(file.contentType)) return fail("Erlaubt sind JPG, PNG und WebP.");
  if (typeof file.size !== "number" || !Number.isInteger(file.size) || file.size < 1) {
    return fail("Die Datei ist leer.");
  }
  if (file.size > MAX_IMAGE_BYTES) return fail("Das Bild ist größer als 8 MB.");

  const bucket = await hitRateLimit(
    deps.db,
    `guide-upload:${admin.adminUserId}`,
    UPLOAD_GRANT_LIMIT.windowMs,
    deps.now(),
  );
  if (bucket.hits > UPLOAD_GRANT_LIMIT.max) {
    deps.logger.warn("guide image upload rate limited", { propertyId: target.propertyId });
    return fail("Zu viele Uploads. Bitte versuche es in einigen Minuten erneut.");
  }

  try {
    const upload = await createSignedImageUpload(
      deps.storage,
      guideImagePath(target, file.contentType),
    );
    deps.logger.info("guide image upload granted", { propertyId: target.propertyId });
    return { ok: true, ...upload };
  } catch {
    deps.logger.error("guide image upload grant failed", { propertyId: target.propertyId });
    return fail("Der Upload konnte nicht vorbereitet werden.");
  }
}

/** Step 3: the stored file must be an allowed image of this tenant/property. */
export async function confirmImageUpload(
  deps: GuideMediaDeps,
  admin: MediaAdmin,
  propertyId: unknown,
  input: { path: unknown; width: unknown; height: unknown },
): Promise<Result<{ image: { src: string; width: number; height: number } }>> {
  const target = await targetFor(deps, admin, propertyId);
  if (!target) return fail("Objekt nicht gefunden.");
  if (typeof input.path !== "string" || !isGuideImagePath(input.path, target)) {
    return fail("Ungültiger Upload.");
  }
  const dimension = (value: unknown) =>
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_DIMENSION;
  if (!dimension(input.width) || !dimension(input.height)) {
    return fail("Bitte eine Bilddatei (JPG, PNG oder WebP) auswählen.");
  }
  try {
    const check = await verifyStoredImage(deps.storage, input.path);
    if (check !== "ok") {
      deps.logger.warn("guide image upload rejected", { propertyId: target.propertyId, check });
      return fail(
        check === "missing"
          ? "Das Bild wurde nicht hochgeladen."
          : "Erlaubt sind JPG, PNG und WebP bis 8 MB.",
      );
    }
  } catch {
    deps.logger.error("guide image verification failed", { propertyId: target.propertyId });
    return fail("Das Bild konnte nicht geprüft werden.");
  }
  return {
    ok: true,
    image: {
      src: publicImageUrl(deps.storage, input.path),
      width: input.width as number,
      height: input.height as number,
    },
  };
}
