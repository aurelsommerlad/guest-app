import { type LocalizedText } from "../i18n/localized-text";
import { type ExploreCategory, type ExploreFilter, type ExplorePlace } from "./explore-model";

export type ExploreContext = { tenantId: string; propertyId: string };

/** A guest sees a place only if it is published, of their tenant and assigned to their property. */
export function isPlaceVisibleFor(
  place: Pick<ExplorePlace, "status" | "tenantId" | "propertyIds">,
  context: ExploreContext,
): boolean {
  return (
    place.status === "published" &&
    place.tenantId === context.tenantId &&
    place.propertyIds.includes(context.propertyId)
  );
}

/** Editorial order: highlights first, then the admin's order, then the title. */
export function compareExplorePlaces(
  a: Pick<ExplorePlace, "featured" | "sortOrder" | "title">,
  b: Pick<ExplorePlace, "featured" | "sortOrder" | "title">,
): number {
  return (
    Number(b.featured) - Number(a.featured) ||
    a.sortOrder - b.sortOrder ||
    (a.title.de ?? "").localeCompare(b.title.de ?? "", "de")
  );
}

/** Places a guest sees, in editorial order. */
export function selectExplorePlaces<T extends ExplorePlace>(
  places: readonly T[],
  context: ExploreContext,
): T[] {
  return places.filter((place) => isPlaceVisibleFor(place, context)).sort(compareExplorePlaces);
}

/** Places of one category (or all). Order is kept. */
export function filterPlacesByCategory<T extends Pick<ExplorePlace, "category">>(
  places: readonly T[],
  filter: ExploreFilter,
): T[] {
  return filter === "all" ? [...places] : places.filter((place) => place.category === filter);
}

/** Categories that actually have places, in taxonomy order. */
export function categoriesOf(
  places: readonly Pick<ExplorePlace, "category">[],
  taxonomy: readonly ExploreCategory[],
): ExploreCategory[] {
  return taxonomy.filter((category) => places.some((place) => place.category === category));
}

/**
 * English is "reviewed" once every German text has an English version, else "missing".
 * Prepared for machine translation later ("machine", "outdated").
 */
export function englishStateOf(
  texts: readonly (LocalizedText | undefined)[],
): "reviewed" | "missing" {
  return texts.every((value) => !value?.de || Boolean(value.en)) ? "reviewed" : "missing";
}
