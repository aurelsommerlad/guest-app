import { isVisible, type VisibilityContext } from "../content/visibility";
import { type ExploreFilter, type ExplorePlace, type PlaceScope } from "./explore-model";

export type ExploreContext = VisibilityContext & { tenantId: string; propertyId: string };

export function placeScopeApplies(scope: PlaceScope, propertyId: string): boolean {
  return scope.level === "tenant" || scope.propertyIds.includes(propertyId);
}

/**
 * Places a guest sees: published, of their tenant, recommended for their property,
 * currently visible – featured first, then by sortOrder.
 */
export function selectExplorePlaces(
  places: readonly ExplorePlace[],
  context: ExploreContext,
): ExplorePlace[] {
  return places
    .filter(
      (place) =>
        place.status === "published" &&
        place.tenantId === context.tenantId &&
        placeScopeApplies(place.scope, context.propertyId) &&
        isVisible(place.visibility, context),
    )
    .sort((a, b) => Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder);
}

/** Places matching an overview filter (any of a place's categories). Order is kept. */
export function filterPlacesByCategory<T extends Pick<ExplorePlace, "categories">>(
  places: readonly T[],
  filter: ExploreFilter,
): T[] {
  return filter === "all"
    ? [...places]
    : places.filter((place) => place.categories.includes(filter));
}
