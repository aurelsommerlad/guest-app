import "server-only";

import { serverEnv } from "../../env/server";
import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { type MediaStorageConfig, mediaPrefix } from "../../server/media-storage";
import { type GuideAdminDeps } from "./guide-admin-service";

export function mediaStorageConfig(): MediaStorageConfig | undefined {
  if (!serverEnv.SUPABASE_URL || !serverEnv.SUPABASE_SERVICE_ROLE_KEY) return undefined;
  return {
    supabaseUrl: serverEnv.SUPABASE_URL,
    serverKey: serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    bucket: serverEnv.GUIDE_MEDIA_BUCKET,
  };
}

export function guideDeps(): GuideAdminDeps {
  const storage = mediaStorageConfig();
  return {
    db: getDatabase(),
    logger,
    now: () => new Date(),
    isAllowedImageSrc: (src, target) =>
      (storage !== undefined &&
        src.startsWith(mediaPrefix(storage, target.tenantId, target.propertyId))) ||
      // Development fixtures (local databases only) are served by the guest app.
      (serverEnv.APP_ENV === "local" && src.startsWith("/fixtures/guide/")),
  };
}
