import { type ExplorePlace } from "@up/core";

import { type PlaceAction } from "./model";

/** Address as display lines; undefined when nothing is set. */
export function addressLines(address: string | undefined): string[] | undefined {
  const lines = (address ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : undefined;
}

/** Only http(s) links leave the app – anything else is dropped (defence in depth). */
function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Actions of a place – each only when its data exists. The route uses the maintained maps
 * link, otherwise an external maps search for the address; no maps API involved.
 */
export function buildPlaceActions(
  place: Pick<ExplorePlace, "address" | "mapsUrl" | "websiteUrl" | "phone" | "reservationUrl">,
): PlaceAction[] {
  const actions: PlaceAction[] = [];
  const address = addressLines(place.address)?.join(", ");
  const route =
    safeHttpUrl(place.mapsUrl) ??
    (address
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
      : undefined);
  if (route) actions.push({ kind: "route", href: route, external: true });
  const website = safeHttpUrl(place.websiteUrl);
  if (website) actions.push({ kind: "website", href: website, external: true });
  const digits = place.phone?.replace(/[^\d+]/g, "");
  if (digits && /\d{3,}/.test(digits)) {
    actions.push({ kind: "call", href: `tel:${digits}`, external: false });
  }
  const reservation = safeHttpUrl(place.reservationUrl);
  if (reservation) actions.push({ kind: "reserve", href: reservation, external: true });
  return actions;
}
