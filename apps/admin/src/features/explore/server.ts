import "server-only";

import { serverEnv } from "../../env/server";
import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { type MediaScope, mediaPathFromUrl, verifyStoredImage } from "../../server/media-storage";
import { mediaStorageConfig } from "../guide/server";
import { type MediaUploadDeps } from "../media/media-upload-service";
import { type ExploreAdminDeps } from "./explore-admin-service";

export const exploreScope = (tenantId: string): MediaScope => ({ tenantId, module: "explore" });

// Development fixtures (local databases only) are served by the apps' public folder.
const isLocalFixture = (src: string) =>
  serverEnv.APP_ENV === "local" && /^\/fixtures\/explore\/[a-z0-9-]+\.(jpg|png|webp)$/.test(src);

export function exploreDeps(): ExploreAdminDeps {
  const storage = mediaStorageConfig();
  return {
    db: getDatabase(),
    logger,
    now: () => new Date(),
    isAllowedImageSrc: (src, tenantId) =>
      (storage !== undefined &&
        mediaPathFromUrl(storage, src, exploreScope(tenantId)) !== undefined) ||
      isLocalFixture(src),
    verifyNewImage: async (src, tenantId) => {
      if (isLocalFixture(src)) return true;
      const path = storage ? mediaPathFromUrl(storage, src, exploreScope(tenantId)) : undefined;
      return storage !== undefined && path !== undefined
        ? (await verifyStoredImage(storage, path)) === "ok"
        : false;
    },
  };
}

export function exploreMediaDeps(): MediaUploadDeps | undefined {
  const storage = mediaStorageConfig();
  return storage ? { db: getDatabase(), logger, now: () => new Date(), storage } : undefined;
}
