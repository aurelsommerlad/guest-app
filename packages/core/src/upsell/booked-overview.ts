/**
 * "Gebucht & angefragt" (concept §5.4) – one list from several sources. Phase 1 prepares the
 * model; the sources follow: Apaleo reservation services (everything booked, from any source
 * – authoritative), Extras requests (bridge, Phase 2), partner requests via UNIQUE PLACES.
 */
export const BOOKED_ITEM_SOURCES = ["apaleo", "extras-request", "partner-request"] as const;
export type BookedItemSource = (typeof BOOKED_ITEM_SOURCES)[number];

export const BOOKED_ITEM_STATUSES = [
  "booked",
  "requested",
  "confirmed",
  "declined",
  "cancelled",
] as const;
export type BookedItemStatus = (typeof BOOKED_ITEM_STATUSES)[number];

export type BookedItem = {
  id: string;
  source: BookedItemSource;
  status: BookedItemStatus;
  /** Matched offer (if any) – for the image and to keep it out of recommendations. */
  offerId?: string;
  title: string;
  /** Property-local service date (YYYY-MM-DD). */
  date?: string;
  quantity?: number;
  priceCents?: number;
  currency?: string;
  /** Where it is paid: on the stay's invoice (folio) or at the partner. */
  payment: "folio" | "partner" | "none";
};

const ORDER: Record<BookedItemStatus, number> = {
  requested: 0,
  booked: 1,
  confirmed: 1,
  declined: 2,
  cancelled: 3,
};

/** Open requests first, then booked by date; declined/cancelled last. */
export function sortBookedItems(items: readonly BookedItem[]): BookedItem[] {
  return [...items].sort(
    (a, b) =>
      ORDER[a.status] - ORDER[b.status] ||
      (a.date ?? "9999").localeCompare(b.date ?? "9999") ||
      a.title.localeCompare(b.title),
  );
}

/** Offer ids that count as taken (not recommended again): booked, requested or confirmed. */
export function takenOfferIds(items: readonly BookedItem[]): Set<string> {
  return new Set(
    items
      .filter((item) => item.offerId && ["booked", "requested", "confirmed"].includes(item.status))
      .map((item) => item.offerId as string),
  );
}
