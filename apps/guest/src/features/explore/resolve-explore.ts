import {
  type ContentImage,
  type ExplorePlace,
  type LocalizedText,
  resolveLocalizedText,
} from "@up/core";

import { type Locale, routing } from "../../i18n/routing";
import { type ResolvedImage } from "../guide/model";
import { type ExploreCard, type PlaceDetail } from "./model";
import { addressLines, buildPlaceActions } from "./place-actions";

/** Pure mapping from EXPLORE content (all locales) to view models (one locale). */
export function createExploreResolver(locale: Locale) {
  const text = (value: LocalizedText) => resolveLocalizedText(value, locale, routing.defaultLocale);
  const image = (value: ContentImage): ResolvedImage => ({
    src: value.src,
    width: value.width,
    height: value.height,
    alt: text(value.alt),
    blurDataUrl: value.blurDataUrl,
  });

  return {
    slug: (place: ExplorePlace) => text(place.slug),

    card: (place: ExplorePlace): ExploreCard => ({
      id: place.id,
      href: `/explore/${text(place.slug)}`,
      title: text(place.title),
      description: text(place.shortDescription),
      categories: place.categories,
      featured: place.featured,
      image: image(place.images[0]),
    }),

    detail: (place: ExplorePlace): PlaceDetail => ({
      id: place.id,
      title: text(place.title),
      category: place.categories[0],
      image: image(place.images[0]),
      recommendation: place.recommendation ? text(place.recommendation) : undefined,
      description: (place.description ?? []).map(text),
      goodToKnow: place.goodToKnow ? text(place.goodToKnow) : undefined,
      openingHours: place.openingHours ? text(place.openingHours) : undefined,
      address: addressLines(place.address),
      phone: place.phone,
      actions: buildPlaceActions(place),
    }),
  };
}
