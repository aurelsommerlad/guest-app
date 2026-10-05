import { type ExplorePlace } from "@up/core";

import { type PlaceAction } from "./model";

/** Address as display lines; undefined when nothing is set. */
export function addressLines(address: ExplorePlace["address"]): string[] | undefined {
  if (!address) return undefined;
  const lines = [
    address.street,
    [address.postalCode, address.city].filter(Boolean).join(" "),
  ].filter((line): line is string => Boolean(line && line.trim()));
  return lines.length > 0 ? lines : undefined;
}

/**
 * Actions of a place – each only when its data exists. The route opens an external
 * maps link (coordinates preferred, else the address); no maps API involved.
 */
export function buildPlaceActions(
  place: Pick<ExplorePlace, "address" | "coordinates" | "website" | "phone" | "bookingUrl">,
): PlaceAction[] {
  const actions: PlaceAction[] = [];

  const destination = place.coordinates
    ? `${String(place.coordinates.lat)},${String(place.coordinates.lng)}`
    : addressLines(place.address)?.join(", ");
  if (destination) {
    actions.push({
      kind: "route",
      href: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`,
      external: true,
    });
  }
  if (place.website) actions.push({ kind: "website", href: place.website, external: true });
  if (place.phone)
    actions.push({
      kind: "call",
      href: `tel:${place.phone.replace(/[^\d+]/g, "")}`,
      external: false,
    });
  if (place.bookingUrl) actions.push({ kind: "reserve", href: place.bookingUrl, external: true });

  return actions;
}
