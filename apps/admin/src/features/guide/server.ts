import "server-only";

import { serverEnv } from "../../env/server";
import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import {
  guideImagePathFromUrl,
  type MediaStorageConfig,
  verifyStoredImage,
} from "../../server/media-storage";
import { type GuideAdminDeps } from "./guide-admin-service";
import { type GuideMediaDeps } from "./guide-media-service";

export function mediaStorageConfig(): MediaStorageConfig | undefined {
  if (!serverEnv.SUPABASE_URL || !serverEnv.SUPABASE_SERVICE_ROLE_KEY) return undefined;
  return {
    supabaseUrl: serverEnv.SUPABASE_URL,
    serverKey: serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    bucket: serverEnv.GUIDE_MEDIA_BUCKET,
  };
}

// Development fixtures (local databases only) are served by the guest app.
const isLocalFixture = (src: string) =>
  serverEnv.APP_ENV === "local" && /^\/fixtures\/guide\/[a-z0-9-]+\.(jpg|png|webp)$/.test(src);

export function guideDeps(): GuideAdminDeps {
  const storage = mediaStorageConfig();
  return {
    db: getDatabase(),
    logger,
    now: () => new Date(),
    isAllowedImageSrc: (src, target) =>
      (storage !== undefined && guideImagePathFromUrl(storage, src, target) !== undefined) ||
      isLocalFixture(src),
    verifyNewImage: async (src, target) => {
      if (isLocalFixture(src)) return true;
      const path = storage ? guideImagePathFromUrl(storage, src, target) : undefined;
      return storage !== undefined && path !== undefined
        ? (await verifyStoredImage(storage, path)) === "ok"
        : false;
    },
  };
}

export function guideMediaDeps(): GuideMediaDeps | undefined {
  const storage = mediaStorageConfig();
  return storage ? { db: getDatabase(), logger, now: () => new Date(), storage } : undefined;
}
