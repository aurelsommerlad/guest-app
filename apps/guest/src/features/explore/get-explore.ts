import "server-only";

import { categoriesOf, EXPLORE_CATEGORIES, type ExploreCategory } from "@up/core";
import { cache } from "react";

import { type Locale } from "../../i18n/routing";
import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { type GuestContext } from "../guest-context/guest-context";
import { loadExplorePlaces } from "./explore-content";
import { type ExploreCard, type PlaceDetail } from "./model";
import { createExploreResolver } from "./resolve-explore";

/** Loaded once per request and guest context (overview, detail page and its metadata). */
const visiblePlaces = cache((context: GuestContext) =>
  loadExplorePlaces(getDatabase(), context, logger),
);

export async function getExploreOverview(
  context: GuestContext,
  locale: Locale,
): Promise<{ cards: ExploreCard[]; categories: ExploreCategory[] }> {
  const places = await visiblePlaces(context);
  const resolver = createExploreResolver(locale);
  return { cards: places.map(resolver.card), categories: categoriesOf(places, EXPLORE_CATEGORIES) };
}

export async function getPlaceDetail(
  context: GuestContext,
  locale: Locale,
  slug: string,
): Promise<PlaceDetail | undefined> {
  const resolver = createExploreResolver(locale);
  const place = (await visiblePlaces(context)).find(
    (candidate) => resolver.slug(candidate) === slug,
  );
  return place ? resolver.detail(place) : undefined;
}
