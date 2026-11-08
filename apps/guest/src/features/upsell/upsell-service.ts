/**
 * Loading the offer catalog for the current stay (framework-free, testable). The property
 * comes from the server-side guest context – never from the browser.
 */
import {
  eligibleOffers,
  localDateOf,
  type Logger,
  type PropertyOffer,
  selectRecommendations,
  type StayFacts,
} from "@up/core";
import { type Database, listOfferRequestsForReservation, listPropertyOffers } from "@up/db";

import { extrasBridgeEnabled, upsellEnabled } from "../../config/upsell";
import { type BridgeSubject, type ExtrasBridge } from "../extras/bridge-client";
import { type GuestContext } from "../guest-context/guest-context";
import { type StayJourney } from "../journey/stay-journey";
import { type MergedExtras, mergeExtras } from "./extras-merge";
import { type HouseServiceFacts, type HouseServiceSource } from "./house-services";
import { isShowable, type OfferView, toOfferView } from "./offer-view";

export type UpsellDeps = {
  db: Database | undefined;
  logger: Logger;
  houseServices: HouseServiceSource;
  /** Phase 2: the Extras bridge (undefined = not configured; Phase 1 behaviour). */
  extras?: ExtrasBridge;
};

export type OfferCatalog = {
  stay: StayFacts;
  /** Offers listed now, in editorial order (without what is already booked or requested). */
  offers: OfferView[];
  /** Every offer with a page – including booked/requested ones (their page shows the state). */
  all: OfferView[];
  /** Raw listed offers (ids, rules) – for recommendations and metrics validation. */
  source: PropertyOffer[];
  /** "Gebucht & angefragt", newest first. */
  booked: BookedOfferView[];
  /**
   * Own services: "preview" (Phase 1 link to the Extras app), "live" (bookable through the
   * bridge) or "unavailable" (bridge configured but not reachable – nothing is guessed).
   */
  house: "preview" | "live" | "unavailable";
};

export type BookedOfferView = {
  id: string;
  title: string;
  status: "booked" | "pending" | "confirmed" | "declined" | "cancelled";
  dates: string[];
  total?: { amountCents: number; currency: string };
  href?: string;
};

export function stayFacts(context: GuestContext, journey: StayJourney): StayFacts {
  return {
    phase: journey.journey.phase,
    today: localDateOf(context.now, journey.window.timeZone),
    arrivalDate: journey.arrivalDate,
  };
}

/** The bridge subject of the current stay – always from the server-side context. */
export function bridgeSubject(context: GuestContext): BridgeSubject | undefined {
  const pms = context.property.pms;
  if (context.reservationProvider !== "apaleo") return undefined;
  return {
    tenantId: context.tenantId,
    apaleoPropertyId: pms.propertyId,
    reservationId: context.externalReservationId,
  };
}

function bridgeFor(deps: UpsellDeps, context: GuestContext) {
  const subject = bridgeSubject(context);
  return deps.extras && subject && extrasBridgeEnabled(context.property)
    ? { bridge: deps.extras, subject }
    : undefined;
}

export async function loadOfferCatalog(
  deps: UpsellDeps,
  context: GuestContext,
  journey: StayJourney,
  locale: string,
): Promise<OfferCatalog | undefined> {
  if (!deps.db || !upsellEnabled(context.property)) return undefined;
  const lang = locale === "en" ? "en" : "de";
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
    const partnerBooked: BookedOfferView[] = requests.flatMap((request) => {
      const offer = all.find((item) => item.id === request.offerId);
      return offer
        ? [
            {
              id: request.id,
              title: toOfferView(offer, locale, undefined).title,
              status: request.status,
              dates: request.requestedDate ? [request.requestedDate] : [],
            },
          ]
        : [];
    });

    const connection = bridgeFor(deps, context);
    let house: OfferCatalog["house"] = "preview";
    let candidates: PropertyOffer[] = all;
    let live: MergedExtras["live"] = new Map();
    let extrasBooked: (BookedOfferView & { offerId?: string })[] = [];
    let facts: ReadonlyMap<string, HouseServiceFacts> = new Map();

    if (connection) {
      const [catalog, overview] = await Promise.all([
        connection.bridge.catalog(connection.subject),
        connection.bridge.overview(connection.subject),
      ]);
      const partners = all.filter((offer) => offer.kind === "partner");
      if (catalog.kind === "ok") {
        house = "live";
        const merged = mergeExtras({
          tenantId: context.tenantId,
          propertyId: context.propertyId,
          locale: lang,
          editorial: all.filter((offer) => offer.kind === "house-service"),
          catalog: catalog.value,
          overview: overview.kind === "ok" ? overview.value : undefined,
        });
        candidates = [...merged.offers, ...partners];
        live = merged.live;
        for (const id of merged.taken) taken.add(id);
        extrasBooked = merged.booked.map((entry) => ({
          id: entry.id,
          title: entry.title,
          status: entry.status,
          dates: entry.dates,
          ...(entry.total ? { total: entry.total } : {}),
          ...(entry.offerId ? { offerId: entry.offerId } : {}),
        }));
      } else {
        house = "unavailable";
        candidates = partners;
      }
    } else {
      const extrasIds = all.flatMap((offer) =>
        offer.extrasServiceId ? [offer.extrasServiceId] : [],
      );
      facts = await deps.houseServices.facts(context.propertyId, extrasIds);
    }

    const factsOf = (offer: PropertyOffer): HouseServiceFacts | undefined =>
      offer.extrasServiceId ? facts.get(offer.extrasServiceId) : undefined;
    const view = (offer: PropertyOffer) =>
      toOfferView(offer, locale, factsOf(offer), live.get(offer.id));
    // Phase rules of the editorial offers apply to Extras services as well.
    const visible = eligibleOffers(candidates, stay).filter(
      (offer) => live.has(offer.id) || isShowable(offer, factsOf(offer)),
    );
    const source = visible.filter((offer) => !taken.has(offer.id));
    const allViews = visible.map(view);
    const hrefOf = new Map(allViews.map((offer) => [offer.id, offer.href]));
    return {
      stay,
      source,
      offers: allViews.filter((offer) => !taken.has(offer.id)),
      all: allViews,
      house,
      booked: [
        ...extrasBooked.map(({ offerId, ...entry }) => {
          const href = offerId ? hrefOf.get(offerId) : undefined;
          return href ? { ...entry, href } : entry;
        }),
        ...partnerBooked,
      ],
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
