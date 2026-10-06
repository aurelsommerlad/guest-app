import type { ExploreCategory } from "@up/core";

import type { TopicFilter } from "../guide/topic-list";
import type { PlaceSummary } from "./explore-admin-service";

/** Same status tabs as GUIDE; "all" = everything except archived. */
export const PLACE_FILTER_LABELS: Record<TopicFilter, string> = {
  all: "Alle",
  published: "Veröffentlicht",
  draft: "Entwurf",
  archived: "Archiviert",
};

/** Property filter in the "Alle Objekte" view: any, one property, or none assigned. */
export type PropertyFilter = "all" | "unassigned" | { propertyId: string };

export function filterPlaces<T extends Pick<PlaceSummary, "category" | "propertyIds">>(
  places: readonly T[],
  filter: { category: ExploreCategory | "all"; property: PropertyFilter },
): T[] {
  return places.filter((place) => {
    if (filter.category !== "all" && place.category !== filter.category) return false;
    if (filter.property === "unassigned") return place.propertyIds.length === 0;
    if (filter.property !== "all") return place.propertyIds.includes(filter.property.propertyId);
    return true;
  });
}

const normalize = (value: string) =>
  value
    .toLocaleLowerCase("de")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

/** Local search over title, teaser, description and place (DE and EN). */
export function searchPlaces<
  T extends Pick<PlaceSummary, "title" | "teaser" | "description" | "locality" | "address">,
>(places: readonly T[], query: string): T[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...places];
  return places.filter((place) => {
    const haystack = normalize(
      [
        place.title.de,
        place.title.en,
        place.teaser.de,
        place.teaser.en,
        place.description?.de,
        place.description?.en,
        place.locality,
        place.address,
      ]
        .filter(Boolean)
        .join(" "),
    );
    return terms.every((term) => haystack.includes(term));
  });
}
