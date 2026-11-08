import "server-only";

import { cache } from "react";

import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { type GuestContext } from "../guest-context/guest-context";
import { getStayJourney } from "../journey/server";
import { getExtrasBridge } from "../extras/server";
import { previewHouseServiceSource } from "./house-services";
import { loadOfferCatalog, type UpsellDeps } from "./upsell-service";

export function upsellDeps(): UpsellDeps {
  // Phase 2: where the bridge is configured (and the property opted in), Extras replaces the
  // preview source; the preview stays the fallback of Phase 1.
  const extras = getExtrasBridge();
  return {
    db: getDatabase(),
    logger,
    houseServices: previewHouseServiceSource,
    ...(extras ? { extras } : {}),
  };
}

/** The offer catalog of the current stay, once per request. */
export const getOfferCatalog = cache(async (context: GuestContext, locale: string) => {
  const journey = await getStayJourney(context);
  return journey ? loadOfferCatalog(upsellDeps(), context, journey, locale) : undefined;
});
