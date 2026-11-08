/**
 * Own services from the Extras bridge, merged with STAY's editorial content (pure, Phase 2).
 *
 * Extras decides WHAT can be booked for this reservation, at WHICH price, and what is already
 * booked or requested. STAY adds only the presentation: where an editorial offer references the
 * Extras service (`extrasServiceId`), its title, text, photo, category and phase rules are used;
 * every other Extras service is shown with the name and description Extras provides. Nothing
 * about prices, limits or availability is kept or computed in STAY.
 */
import { DEFAULT_AVAILABILITY, type OfferCategory, type PropertyOffer } from "@up/core";

import {
  type ExtrasCatalog,
  type ExtrasExtension,
  type ExtrasItem,
  type ExtrasOverview,
} from "../extras/bridge-client";
import { type OfferPriceView } from "./offer-view";

export type ExtrasState = "open" | "booked" | "requested" | "confirmed" | "declined";

export type ExtrasBookingView =
  | {
      kind: "service";
      serviceId: string;
      fulfillment: "instant" | "request";
      actionType: "service" | "increase_occupancy";
      /** Binding unit price from Extras; null = Extras shows no price (not bookable here). */
      unitCents: number | null;
      currency: string;
      /** Nights the unit price applies to (per-night services), else 1. */
      nights: number;
      /** Highest quantity the guest may choose (from Extras' limits). */
      maxQuantity: number;
      /** Whether a quantity choice makes sense at all. */
      quantity: boolean;
      requiresPlate: boolean;
      existingPlate: string | null;
      serviceDates: string[];
      state: ExtrasState;
    }
  | {
      kind: "extension";
      currentDeparture: string;
      newDeparture: string;
      accommodationCents: number | null;
      extras: { name: string; cents: number | null }[];
      cityTaxCents: number | null;
      totalCents: number;
      currency: string;
      state: ExtrasState;
    };

export type ExtrasBookedEntry = {
  id: string;
  title: string;
  status: "booked" | "pending" | "confirmed" | "declined";
  /** Service dates or the new departure date (YYYY-MM-DD). */
  dates: string[];
  total?: { amountCents: number; currency: string };
  /** For the link back to the offer, if it is still shown. */
  offerId?: string;
};

export type MergedExtras = {
  offers: PropertyOffer[];
  live: Map<string, { price: OfferPriceView; booking: ExtrasBookingView }>;
  booked: ExtrasBookedEntry[];
  /** Offers already booked or requested – not recommended, not listed again. */
  taken: Set<string>;
};

/** Presentation fallback for Extras services without editorial content. */
function fallbackCategory(item: ExtrasItem): OfferCategory {
  if (item.actionType === "increase_occupancy") return "comfort";
  switch ((item.code ?? "").toUpperCase()) {
    case "ECI":
    case "LCO":
      return "arrival-departure";
    case "HUND":
    case "DOG":
      return "pets";
    case "PKW":
    case "PARKING":
      return "mobility";
    default:
      return "comfort";
  }
}

export const EXTENSION_OFFER_ID = "extras-extension";
const EXTENSION_SLUG = { de: "verlaengerungsnacht", en: "extra-night" };
/** The extension night is no Apaleo service – its wording lives here, its offer in Extras. */
const EXTENSION_TEXT = {
  title: { de: "Eine Nacht länger", en: "One more night" },
  teaser: {
    de: "Noch nicht abreisen: Dein Apartment ist eine weitere Nacht frei.",
    en: "Not leaving yet: your apartment is free for one more night.",
  },
};

function synthetic(
  base: { tenantId: string; propertyId: string },
  id: string,
  fields: Pick<PropertyOffer, "category" | "slug" | "title" | "teaser"> & { order: number },
): PropertyOffer {
  return {
    id,
    tenantId: base.tenantId,
    propertyId: base.propertyId,
    kind: "house-service",
    category: fields.category,
    status: "published",
    slug: fields.slug,
    title: fields.title,
    teaser: fields.teaser,
    gallery: [],
    fulfillment: "instant",
    cancellation: { type: "on-request" },
    availability: DEFAULT_AVAILABILITY,
    featured: false,
    sortOrder: fields.order,
    propertySortOrder: 1000 + fields.order,
    translationState: {},
  };
}

function priceOf(item: ExtrasItem): OfferPriceView {
  if (!item.unitPrice) return { kind: "at-booking" };
  return {
    kind: "amount",
    amountCents: item.unitPrice.amountCents,
    currency: item.unitPrice.currency,
    per:
      item.actionType === "increase_occupancy"
        ? "person-night"
        : item.bookingRule === "per_night"
          ? "night"
          : "stay",
    from: false,
  };
}

const QUANTITY_CAP = 4;

function bookingOf(item: ExtrasItem, state: ExtrasState): ExtrasBookingView {
  const limit = item.maxQuantity ?? QUANTITY_CAP;
  const maxQuantity = Math.max(0, Math.min(limit, QUANTITY_CAP));
  return {
    kind: "service",
    serviceId: item.serviceId,
    fulfillment: item.fulfillment,
    actionType: item.actionType,
    unitCents: item.unitPrice?.amountCents ?? null,
    currency: item.unitPrice?.currency ?? "EUR",
    nights: item.nights ?? 1,
    maxQuantity,
    // A quantity only where Extras itself offers one: more guests, more cars, more cots.
    quantity:
      maxQuantity > 1 &&
      !item.maxOnePerReservation &&
      (item.actionType === "increase_occupancy" ||
        item.requiresVehicleRegistration ||
        item.fulfillment === "request"),
    requiresPlate: item.requiresVehicleRegistration,
    existingPlate: item.existingVehicleRegistration,
    serviceDates: item.serviceDates,
    state,
  };
}

function extensionBooking(extension: ExtrasExtension, state: ExtrasState, locale: "de" | "en") {
  const total = extension.totalPrice;
  if (!total) return undefined;
  const booking: ExtrasBookingView = {
    kind: "extension",
    currentDeparture: extension.currentDeparture,
    newDeparture: extension.newDeparture,
    accommodationCents: extension.extensionPrice?.amountCents ?? null,
    extras: extension.extras.map((extra) => ({
      name: extra.name[locale],
      cents: extra.amountCents,
    })),
    cityTaxCents: extension.cityTaxCents,
    totalCents: total.amountCents,
    currency: total.currency,
    state,
  };
  const price: OfferPriceView = {
    kind: "amount",
    amountCents: total.amountCents,
    currency: total.currency,
    per: "stay",
    from: false,
  };
  return { booking, price };
}

export function mergeExtras(input: {
  tenantId: string;
  propertyId: string;
  locale: "de" | "en";
  /** STAY's editorial house-service offers of the property. */
  editorial: readonly PropertyOffer[];
  catalog: ExtrasCatalog;
  overview: ExtrasOverview | undefined;
}): MergedExtras {
  const { locale, catalog, overview } = input;
  const base = { tenantId: input.tenantId, propertyId: input.propertyId };
  const byService = new Map(
    input.editorial.flatMap((offer) =>
      offer.kind === "house-service" && offer.extrasServiceId
        ? [[offer.extrasServiceId, offer] as const]
        : [],
    ),
  );
  const latestRequest = new Map<string, ExtrasOverview["requests"][number]>();
  for (const request of overview?.requests ?? []) {
    if (!latestRequest.has(request.serviceId)) latestRequest.set(request.serviceId, request);
  }

  const offers: PropertyOffer[] = [];
  const live: MergedExtras["live"] = new Map();
  const taken = new Set<string>();
  const offerIdByService = new Map<string, string>();

  catalog.items.forEach((item, index) => {
    // Restricted for this apartment type: Extras would only show it disabled – STAY leaves it out.
    if (item.restricted) return;
    const editorial = byService.get(item.serviceId);
    const offer =
      editorial ??
      synthetic(base, `extras-${item.serviceId}`, {
        category: fallbackCategory(item),
        slug: { de: `extra-${item.serviceId.toLowerCase()}` },
        title: item.name,
        teaser: item.description,
        order: index,
      });
    const request = latestRequest.get(item.serviceId);
    const state: ExtrasState =
      item.actionType === "service" && item.bookedCount > 0
        ? "booked"
        : request?.status === "pending"
          ? "requested"
          : request?.status === "approved"
            ? "confirmed"
            : "open";
    if (state !== "open") taken.add(offer.id);
    offers.push(offer);
    live.set(offer.id, { price: priceOf(item), booking: bookingOf(item, state) });
    offerIdByService.set(item.serviceId, offer.id);
  });

  const extendedTo = overview?.extensions[0]?.newDeparture;
  if (catalog.extension) {
    const built = extensionBooking(catalog.extension, "open", locale);
    if (built) {
      offers.push(
        synthetic(base, EXTENSION_OFFER_ID, {
          category: "longer-stay",
          slug: EXTENSION_SLUG,
          title: EXTENSION_TEXT.title,
          teaser: EXTENSION_TEXT.teaser,
          order: 999,
        }),
      );
      live.set(EXTENSION_OFFER_ID, built);
    }
  }

  const booked: ExtrasBookedEntry[] = [];
  for (const entry of overview?.booked ?? []) {
    booked.push({
      id: `booked-${entry.serviceId}`,
      title: entry.name[locale],
      status: "booked",
      dates: entry.dates,
      ...(entry.total ? { total: entry.total } : {}),
      ...(offerIdByService.get(entry.serviceId)
        ? { offerId: offerIdByService.get(entry.serviceId) }
        : {}),
    });
  }
  for (const amendment of overview?.amendments ?? []) {
    booked.push({
      id: `amendment-${amendment.serviceId}-${amendment.createdAt}`,
      title:
        amendment.count > 1
          ? `${amendment.name[locale]} (${String(amendment.count)})`
          : amendment.name[locale],
      status: "booked",
      dates: [],
      ...(amendment.total ? { total: amendment.total } : {}),
    });
  }
  for (const request of overview?.requests ?? []) {
    const item = catalog.items.find((candidate) => candidate.serviceId === request.serviceId);
    booked.push({
      id: `request-${request.requestId}`,
      title: item?.name[locale] ?? request.serviceName ?? request.serviceId,
      status:
        request.status === "pending"
          ? "pending"
          : request.status === "approved"
            ? "confirmed"
            : "declined",
      dates: [],
      ...(offerIdByService.get(request.serviceId)
        ? { offerId: offerIdByService.get(request.serviceId) }
        : {}),
    });
  }
  if (extendedTo) {
    booked.push({
      id: `extension-${extendedTo}`,
      title: EXTENSION_TEXT.title[locale],
      status: "booked",
      dates: [extendedTo],
    });
  }
  return { offers, live, booked, taken };
}
