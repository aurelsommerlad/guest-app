import "server-only";

import { serverEnv } from "../../env/server";
import { apaleoPropertyIdOf, apaleoServiceSource } from "../../server/apaleo-services";
import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { type MediaScope, mediaPathFromUrl } from "../../server/media-storage";
import { mediaStorageConfig } from "../guide/server";
import { type MediaUploadDeps } from "../media/media-upload-service";
import { type CatalogDeps } from "./catalog-service";

/** Offer images are tenant-wide (one central offer serves several properties). */
export const offersScope = (tenantId: string): MediaScope => ({ tenantId, module: "offers" });

const isLocalFixture = (src: string) =>
  serverEnv.APP_ENV === "local" && /^\/fixtures\/[a-z0-9/-]+\.(jpg|png|webp)$/.test(src);

export function catalogDeps(): CatalogDeps {
  const storage = mediaStorageConfig();
  return {
    db: getDatabase(),
    logger,
    now: () => new Date(),
    apaleo: apaleoServiceSource(),
    apaleoPropertyIdOf,
    isAllowedImageSrc: (src, tenantId) =>
      (storage !== undefined &&
        mediaPathFromUrl(storage, src, offersScope(tenantId)) !== undefined) ||
      isLocalFixture(src),
  };
}

export function offersMediaDeps(): MediaUploadDeps | undefined {
  const storage = mediaStorageConfig();
  return storage ? { db: getDatabase(), logger, now: () => new Date(), storage } : undefined;
}
