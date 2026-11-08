import "server-only";

import { cache } from "react";

import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { type GuestContext } from "../guest-context/guest-context";
import { getStayJourney } from "../journey/server";
import { previewHouseServiceSource } from "./house-services";
import { loadOfferCatalog, type UpsellDeps } from "./upsell-service";

export function upsellDeps(): UpsellDeps {
  // Phase 2: the Extras bridge replaces the preview source.
  return { db: getDatabase(), logger, houseServices: previewHouseServiceSource };
}

/** The offer catalog of the current stay, once per request. */
export const getOfferCatalog = cache(async (context: GuestContext, locale: string) => {
  const journey = await getStayJourney(context);
  return journey ? loadOfferCatalog(upsellDeps(), context, journey, locale) : undefined;
});
