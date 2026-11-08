/**
 * Few, well-chosen recommendations (concept §5.3): eligibility → weight → selection.
 * Deterministic and explainable – only facts of the stay, no profiles, no viewing history.
 */
import { isOfferAvailable, type StayFacts } from "./availability";
import { type OfferCategory, type PropertyOffer } from "./offer-model";

export type RecommendationContext = StayFacts & {
  /** Offers the guest already booked or requested (ids) – never recommended again. */
  takenOfferIds?: ReadonlySet<string>;
};

export type Recommendation<T extends PropertyOffer = PropertyOffer> = {
  offer: T;
  score: number;
  /** Why it was chosen (for diagnostics/tests – never shown to the guest). */
  reasons: readonly ("focus-phase" | "featured" | "house-service")[];
};

/** Offers that may be shown to this stay at all, in editorial order. */
export function eligibleOffers<T extends PropertyOffer>(
  offers: readonly T[],
  context: RecommendationContext,
): T[] {
  return offers
    .filter(
      (offer) =>
        offer.status === "published" &&
        !context.takenOfferIds?.has(offer.id) &&
        isOfferAvailable(offer.availability, context),
    )
    .sort(
      (a, b) =>
        a.propertySortOrder - b.propertySortOrder ||
        a.sortOrder - b.sortOrder ||
        a.id.localeCompare(b.id),
    );
}

/**
 * The personal selection for one surface: at most `limit` offers (home: 3), at most one per
 * category, focus phase first, then featured; own services win a tie before arrival
 * (they shape the stay itself), partner experiences win it during the stay.
 */
export function selectRecommendations<T extends PropertyOffer>(
  offers: readonly T[],
  context: RecommendationContext,
  limit = 3,
): Recommendation<T>[] {
  const scored = eligibleOffers(offers, context).map((offer, index) => {
    const reasons: Recommendation["reasons"][number][] = [];
    let score = 0;
    if (offer.availability.focusPhases.includes(context.phase)) {
      score += 100;
      reasons.push("focus-phase");
    }
    if (offer.featured) {
      score += 30;
      reasons.push("featured");
    }
    const ownFirst = context.phase === "before-arrival" || context.phase === "arrival-day";
    if ((offer.kind === "house-service") === ownFirst) {
      score += 10;
      if (offer.kind === "house-service") reasons.push("house-service");
    }
    // Keep the editorial order as the final tie-breaker.
    return { offer, score: score - index / 1000, reasons };
  });
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<OfferCategory>();
  const picked: Recommendation<T>[] = [];
  for (const entry of scored) {
    if (picked.length >= limit) break;
    if (seen.has(entry.offer.category)) continue;
    seen.add(entry.offer.category);
    picked.push({ offer: entry.offer, score: Math.round(entry.score), reasons: entry.reasons });
  }
  return picked;
}
