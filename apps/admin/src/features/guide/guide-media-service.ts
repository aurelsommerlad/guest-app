/**
 * GUIDE image uploads (ADR 0013): images belong to one property of the admin's tenant.
 * The generic signed-upload logic lives in features/media.
 */
import { getPropertyById } from "@up/db";

import { type MediaScope } from "../../server/media-storage";
import {
  confirmMediaUpload,
  type MediaAdmin,
  type MediaResult,
  type MediaUploadDeps,
  requestMediaUpload,
} from "../media/media-upload-service";

export { UPLOAD_GRANT_LIMIT } from "../media/media-upload-service";
export type GuideMediaDeps = MediaUploadDeps;

async function guideScope(
  deps: GuideMediaDeps,
  admin: MediaAdmin,
  propertyId: unknown,
): Promise<MediaScope | undefined> {
  if (typeof propertyId !== "string") return undefined;
  const property = await getPropertyById(deps.db, { tenantId: admin.tenantId }, propertyId);
  return property
    ? { tenantId: admin.tenantId, propertyId: property.id, module: "guide" }
    : undefined;
}

/** Step 1: checks and a signed upload for exactly one freshly generated path. */
export async function requestImageUpload(
  deps: GuideMediaDeps,
  admin: MediaAdmin,
  propertyId: unknown,
  file: { contentType: unknown; size: unknown },
): Promise<MediaResult<{ uploadUrl: string; path: string }>> {
  const scope = await guideScope(deps, admin, propertyId);
  if (!scope) return { ok: false, error: "Objekt nicht gefunden." };
  return requestMediaUpload(deps, admin, scope, file);
}

/** Step 3: the stored file must be an allowed image of this tenant/property. */
export async function confirmImageUpload(
  deps: GuideMediaDeps,
  admin: MediaAdmin,
  propertyId: unknown,
  input: { path: unknown; width: unknown; height: unknown },
): Promise<MediaResult<{ image: { src: string; width: number; height: number } }>> {
  const scope = await guideScope(deps, admin, propertyId);
  if (!scope) return { ok: false, error: "Objekt nicht gefunden." };
  return confirmMediaUpload(deps, admin, scope, input);
}
