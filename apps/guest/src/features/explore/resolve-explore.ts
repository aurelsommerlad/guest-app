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

/**
 * Pure mapping from EXPLORE content (all locales) to view models (one locale). Missing
 * English texts fall back to German – never to an invented translation.
 */
export function createExploreResolver(locale: Locale) {
  const text = (value: LocalizedText) => resolveLocalizedText(value, locale, routing.defaultLocale);
  const image = (value: ContentImage | undefined): ResolvedImage | undefined =>
    value
      ? {
          src: value.src,
          width: value.width,
          height: value.height,
          alt: text(value.alt),
          blurDataUrl: value.blurDataUrl,
        }
      : undefined;
  const paragraphs = (value: LocalizedText | undefined) =>
    value
      ? text(value)
          .split(/\n\s*\n/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean)
      : [];

  return {
    slug: (place: ExplorePlace) => text(place.slug),

    card: (place: ExplorePlace): ExploreCard => ({
      id: place.id,
      href: `/explore/${text(place.slug)}`,
      title: text(place.title),
      teaser: text(place.teaser),
      category: place.category,
      featured: place.featured,
      ...(place.locality ? { locality: place.locality } : {}),
      ...(place.heroImage ? { image: image(place.heroImage) } : {}),
    }),

    detail: (place: ExplorePlace): PlaceDetail => ({
      id: place.id,
      title: text(place.title),
      category: place.category,
      teaser: text(place.teaser),
      description: paragraphs(place.description),
      ...(place.heroImage ? { image: image(place.heroImage) } : {}),
      ...(place.tip ? { tip: text(place.tip) } : {}),
      ...(place.openingHours ? { openingHours: text(place.openingHours) } : {}),
      ...(addressLines(place.address) ? { address: addressLines(place.address) } : {}),
      actions: buildPlaceActions(place),
    }),
  };
}
