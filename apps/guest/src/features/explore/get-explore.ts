import "server-only";

import { resolveLocalizedText, selectExplorePlaces } from "@up/core";

import { type HeaderProperty } from "../../components/GuestHeader";
import { type Locale, routing } from "../../i18n/routing";
import { exploreIntroByProperty, hovExplorePlaces } from "../../mocks/explore/hov-explore";
import { getGuestContext, headerPropertyOf } from "../guest-context";
import { type ExploreCard, type ExploreIntro, type PlaceDetail } from "./model";
import { createExploreResolver } from "./resolve-explore";

/** EXPLORE data access: mock content for the guest context. Later: our database. */
function visiblePlaces() {
  const { property, now, stay } = getGuestContext();
  return selectExplorePlaces(hovExplorePlaces, {
    tenantId: property.tenantId,
    propertyId: property.id,
    now,
    access: "reservation",
    stay,
  });
}

export function getExploreProperty(): HeaderProperty {
  return headerPropertyOf(getGuestContext().property);
}

export function getExploreIntro(locale: Locale): ExploreIntro | undefined {
  const intro = exploreIntroByProperty[getGuestContext().property.id];
  if (!intro) return undefined;
  return {
    title: resolveLocalizedText(intro.title, locale, routing.defaultLocale),
    lead: resolveLocalizedText(intro.lead, locale, routing.defaultLocale),
  };
}

export function getExploreCards(locale: Locale): ExploreCard[] {
  const resolver = createExploreResolver(locale);
  return visiblePlaces().map(resolver.card);
}

export function getPlaceDetail(locale: Locale, slug: string): PlaceDetail | undefined {
  const resolver = createExploreResolver(locale);
  const place = visiblePlaces().find((candidate) => resolver.slug(candidate) === slug);
  return place ? resolver.detail(place) : undefined;
}

/** Slugs for static generation of the detail pages. */
export function getExploreSlugs(locale: Locale): string[] {
  const resolver = createExploreResolver(locale);
  return visiblePlaces().map(resolver.slug);
}
