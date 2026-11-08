import "server-only";

import { serverEnv } from "../../env/server";
import { logger } from "../../server/logger";
import { createExtrasBridge, type ExtrasBridge } from "./bridge-client";

let bridge: ExtrasBridge | undefined;

/** The Extras bridge client, or undefined while EXTRAS_BRIDGE_URL / _SECRET are not set. */
export function getExtrasBridge(): ExtrasBridge | undefined {
  const url = serverEnv.EXTRAS_BRIDGE_URL;
  const secret = serverEnv.EXTRAS_BRIDGE_SECRET;
  if (!url || !secret) return undefined;
  bridge ??= createExtrasBridge({
    baseUrl: url,
    secret,
    ...(serverEnv.EXTRAS_BRIDGE_PROTECTION_BYPASS
      ? { protectionBypass: serverEnv.EXTRAS_BRIDGE_PROTECTION_BYPASS }
      : {}),
    onError: (route, detail) => {
      logger.warn("extras bridge unavailable", { route, ...detail });
    },
  });
  return bridge;
}
