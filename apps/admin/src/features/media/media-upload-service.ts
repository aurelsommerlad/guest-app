/**
 * Signed image uploads for every admin module (ADR 0013/0015): the server issues a signed
 * upload for one freshly generated path of a scope and verifies the stored file afterwards.
 * Callers resolve the scope from the admin session (tenant) and – where needed – a
 * tenant-checked property; the browser never chooses a path.
 */
import { type Logger, type TenantContext } from "@up/core";
import { type Database, hitRateLimit } from "@up/db";

import {
  createSignedImageUpload,
  isImageType,
  isMediaImagePath,
  MAX_IMAGE_BYTES,
  mediaImagePath,
  type MediaScope,
  type MediaStorageConfig,
  publicImageUrl,
  verifyStoredImage,
} from "../../server/media-storage";

export type MediaUploadDeps = {
  db: Database;
  logger: Logger;
  now: () => Date;
  storage: MediaStorageConfig;
};

export type MediaAdmin = TenantContext & { adminUserId: string };

export type MediaResult<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Upload grants per admin account: generous for editing, bounded against abuse. */
export const UPLOAD_GRANT_LIMIT = { windowMs: 15 * 60 * 1000, max: 60 } as const;

const MAX_DIMENSION = 20_000;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Step 1: type/size checks, rate limit and a signed upload for exactly one generated path. */
export async function requestMediaUpload(
  deps: MediaUploadDeps,
  admin: MediaAdmin,
  scope: MediaScope,
  file: { contentType: unknown; size: unknown },
): Promise<MediaResult<{ uploadUrl: string; path: string }>> {
  if (scope.tenantId !== admin.tenantId) return fail("Nicht erlaubt.");
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
  const logContext = {
    module: scope.module,
    ...(scope.propertyId ? { propertyId: scope.propertyId } : {}),
  };
  if (bucket.hits > UPLOAD_GRANT_LIMIT.max) {
    deps.logger.warn("guide image upload rate limited", logContext);
    return fail("Zu viele Uploads. Bitte versuche es in einigen Minuten erneut.");
  }

  try {
    const upload = await createSignedImageUpload(
      deps.storage,
      mediaImagePath(scope, file.contentType),
    );
    deps.logger.info("guide image upload granted", logContext);
    return { ok: true, ...upload };
  } catch {
    deps.logger.error("guide image upload grant failed", logContext);
    return fail("Der Upload konnte nicht vorbereitet werden.");
  }
}

/** Step 3: the stored file must be an allowed image under this scope's prefix. */
export async function confirmMediaUpload(
  deps: MediaUploadDeps,
  admin: MediaAdmin,
  scope: MediaScope,
  input: { path: unknown; width: unknown; height: unknown },
): Promise<MediaResult<{ image: { src: string; width: number; height: number } }>> {
  if (scope.tenantId !== admin.tenantId) return fail("Nicht erlaubt.");
  if (typeof input.path !== "string" || !isMediaImagePath(input.path, scope)) {
    return fail("Ungültiger Upload.");
  }
  const dimension = (value: unknown) =>
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_DIMENSION;
  if (!dimension(input.width) || !dimension(input.height)) {
    return fail("Bitte eine Bilddatei (JPG, PNG oder WebP) auswählen.");
  }
  const logContext = {
    module: scope.module,
    ...(scope.propertyId ? { propertyId: scope.propertyId } : {}),
  };
  try {
    const check = await verifyStoredImage(deps.storage, input.path);
    if (check !== "ok") {
      deps.logger.warn("guide image upload rejected", { ...logContext, check });
      return fail(
        check === "missing"
          ? "Das Bild wurde nicht hochgeladen."
          : "Erlaubt sind JPG, PNG und WebP bis 8 MB.",
      );
    }
  } catch {
    deps.logger.error("guide image verification failed", logContext);
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
