import "server-only";

import { resolveLocalizedText, selectExplorePlaces } from "@up/core";

import { type Locale, routing } from "../../i18n/routing";
import { exploreIntroByProperty, hovExplorePlaces } from "../../mocks/explore/hov-explore";
import { type GuestContext, stayWindowOf } from "../guest-context/guest-context";
import { type ExploreCard, type ExploreIntro, type PlaceDetail } from "./model";
import { createExploreResolver } from "./resolve-explore";

/** EXPLORE data access: content (mock until the database) selected for the guest context. */
function visiblePlaces(context: GuestContext) {
  const stay = stayWindowOf(context);
  return selectExplorePlaces(hovExplorePlaces, {
    tenantId: context.tenantId,
    propertyId: context.propertyId,
    now: context.now,
    access: "reservation",
    ...(stay ? { stay } : {}),
  });
}

export function getExploreIntro(context: GuestContext, locale: Locale): ExploreIntro | undefined {
  const intro = exploreIntroByProperty[context.propertyId];
  if (!intro) return undefined;
  return {
    title: resolveLocalizedText(intro.title, locale, routing.defaultLocale),
    lead: resolveLocalizedText(intro.lead, locale, routing.defaultLocale),
  };
}

export function getExploreCards(context: GuestContext, locale: Locale): ExploreCard[] {
  const resolver = createExploreResolver(locale);
  return visiblePlaces(context).map(resolver.card);
}

export function getPlaceDetail(
  context: GuestContext,
  locale: Locale,
  slug: string,
): PlaceDetail | undefined {
  const resolver = createExploreResolver(locale);
  const place = visiblePlaces(context).find((candidate) => resolver.slug(candidate) === slug);
  return place ? resolver.detail(place) : undefined;
}
