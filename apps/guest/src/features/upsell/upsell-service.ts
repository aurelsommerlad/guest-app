/**
 * Loading the offer catalog for the current stay (framework-free, testable). The property
 * comes from the server-side guest context – never from the browser.
 */
import {
  eligibleOffers,
  localDateOf,
  type Logger,
  type PropertyOffer,
  type RecommendationContext,
  selectRecommendations,
  type StayFacts,
} from "@up/core";
import {
  type Database,
  listOfferRequestsForReservation,
  listPropertyOffers,
  type OfferRequestRecord,
} from "@up/db";

import { upsellEnabled } from "../../config/upsell";
import { type GuestContext } from "../guest-context/guest-context";
import { type StayJourney } from "../journey/stay-journey";
import { type HouseServiceFacts, type HouseServiceSource } from "./house-services";
import { isShowable, type OfferView, toOfferView } from "./offer-view";

export type UpsellDeps = {
  db: Database | undefined;
  logger: Logger;
  houseServices: HouseServiceSource;
};

export type OfferCatalog = {
  stay: StayFacts;
  /** All offers that may be shown now, in editorial order. */
  offers: OfferView[];
  /** Raw offers (ids, rules) – for recommendations and metrics validation. */
  source: PropertyOffer[];
  /** Requests of this reservation (prepared; "Gebucht & angefragt"), newest first. */
  booked: BookedOfferView[];
};

export type BookedOfferView = {
  id: string;
  offerId: string;
  title: string;
  status: OfferRequestRecord["status"];
};

export function stayFacts(context: GuestContext, journey: StayJourney): StayFacts {
  return {
    phase: journey.journey.phase,
    today: localDateOf(context.now, journey.window.timeZone),
    arrivalDate: journey.arrivalDate,
  };
}

export async function loadOfferCatalog(
  deps: UpsellDeps,
  context: GuestContext,
  journey: StayJourney,
  locale: string,
): Promise<OfferCatalog | undefined> {
  if (!deps.db || !upsellEnabled(context.property)) return undefined;
  try {
    const all = await listPropertyOffers(deps.db, context, context.propertyId);
    const requests = await listOfferRequestsForReservation(deps.db, context, {
      reservationProvider: context.reservationProvider,
      externalReservationId: context.externalReservationId,
    });
    const stay = stayFacts(context, journey);
    const taken = new Set(
      requests
        .filter((request) => request.status === "pending" || request.status === "confirmed")
        .map((request) => request.offerId),
    );
    const extrasIds = all.flatMap((offer) =>
      offer.extrasServiceId ? [offer.extrasServiceId] : [],
    );
    const facts = await deps.houseServices.facts(context.propertyId, extrasIds);
    const factsOf = (offer: PropertyOffer): HouseServiceFacts | undefined =>
      offer.extrasServiceId ? facts.get(offer.extrasServiceId) : undefined;
    const context_: RecommendationContext = { ...stay, takenOfferIds: taken };
    const source = eligibleOffers(all, context_).filter((offer) =>
      isShowable(offer, factsOf(offer)),
    );
    return {
      stay,
      source,
      offers: source.map((offer) => toOfferView(offer, locale, factsOf(offer))),
      booked: requests.flatMap((request) => {
        const offer = all.find((item) => item.id === request.offerId);
        return offer
          ? [
              {
                id: request.id,
                offerId: request.offerId,
                title: toOfferView(offer, locale, factsOf(offer)).title,
                status: request.status,
              },
            ]
          : [];
      }),
    };
  } catch (error) {
    deps.logger.error("offer catalog could not be loaded", {
      propertyId: context.propertyId,
      error: error instanceof Error ? { name: error.name } : "unknown",
    });
    return undefined;
  }
}

/** The personal selection for the home page: few offers, matching the stay's phase. */
export function homeRecommendations(catalog: OfferCatalog, limit = 3): OfferView[] {
  const ids = selectRecommendations(catalog.source, catalog.stay, limit).map((r) => r.offer.id);
  return ids.flatMap((id) => catalog.offers.filter((offer) => offer.id === id));
}
