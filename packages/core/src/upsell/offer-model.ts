/**
 * Upselling catalog of STAY (concept docs/concepts/upselling-plattform.md, Phase 1).
 *
 * One catalog, two kinds of offers:
 * - "house-service": UNIQUE PLACES' own services (dog, parking, early check-in, late check-out,
 *   extra person, extra night …). Price, availability and booking stay with the Extras app
 *   (the only service writing to Apaleo); STAY keeps the editorial presentation and links a
 *   property's offer to the Extras service via its reference (`extrasServiceId`).
 * - "partner": local offers and experiences of partners. Requests run through UNIQUE PLACES
 *   (Slack); a booking link to the partner is the alternative.
 *
 * Curated and editorial: few offers, large photographs, no shop grid.
 */
import { type ContentImage, type GuideStatus, type TranslationState } from "../guide/guide-model";
import { type LocalizedText } from "../i18n/localized-text";
import { EXPLORE_CATEGORIES } from "../explore/explore-model";
import { type JourneyPhase } from "../journey/guest-journey";

export const OFFER_KINDS = ["house-service", "partner"] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

/** Chapters of "Services & Erlebnisse" – derived from the kind, never stored twice. */
export const OFFER_CHAPTERS = ["stay", "region"] as const;
export type OfferChapter = (typeof OFFER_CHAPTERS)[number];

export function chapterOf(kind: OfferKind): OfferChapter {
  return kind === "house-service" ? "stay" : "region";
}

/** Categories of own services. */
export const HOUSE_SERVICE_CATEGORIES = [
  "arrival-departure",
  "longer-stay",
  "mobility",
  "pets",
  "comfort",
  "food",
] as const;

/**
 * Partner offers use the EXPLORE taxonomy (one regional taxonomy for places and offers).
 * Central list: a new category is one entry, a DB check update and two labels.
 */
export const PARTNER_CATEGORIES = EXPLORE_CATEGORIES;

export const OFFER_CATEGORIES = [...HOUSE_SERVICE_CATEGORIES, ...PARTNER_CATEGORIES] as const;
export type OfferCategory = (typeof OFFER_CATEGORIES)[number];

export function categoriesFor(kind: OfferKind): readonly OfferCategory[] {
  return kind === "house-service" ? HOUSE_SERVICE_CATEGORIES : PARTNER_CATEGORIES;
}

/**
 * How the guest takes up an offer:
 * - instant: booked onto the folio right away (house services, via the Extras bridge – Phase 2);
 * - request: recorded as a request; UNIQUE PLACES confirms (house services "auf Anfrage",
 *   partner offers – always via UNIQUE PLACES, Slack notification);
 * - link: booked on the partner's own page (no data handed over).
 */
export const FULFILLMENT_TYPES = ["instant", "request", "link"] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];

export function fulfillmentsFor(kind: OfferKind): readonly FulfillmentType[] {
  return kind === "house-service" ? ["instant", "request"] : ["request", "link"];
}

/* ------------------------------------------------------------------------------------------
 * Price (partner offers – house services take theirs from the Extras catalog)
 * ---------------------------------------------------------------------------------------- */

export const PRICE_MODELS = ["fixed", "from", "per-person", "on-request"] as const;
export type PriceModel = (typeof PRICE_MODELS)[number];

export type OfferPrice =
  | { model: "on-request" }
  | { model: Exclude<PriceModel, "on-request">; amountCents: number; currency: string };

/* ------------------------------------------------------------------------------------------
 * Cancellation – configurable per service (decision 2026-11-08)
 * ---------------------------------------------------------------------------------------- */

export const CANCELLATION_TYPES = [
  /** Free cancellation until `hoursBefore` the service starts. */
  "free-until",
  /** Booked is booked. */
  "non-refundable",
  /** Decided case by case by UNIQUE PLACES. */
  "on-request",
  /** The partner's own terms apply (shown on the partner page / in the confirmation). */
  "partner-terms",
] as const;
export type CancellationType = (typeof CANCELLATION_TYPES)[number];

export type CancellationPolicy =
  { type: "free-until"; hoursBefore: number } | { type: Exclude<CancellationType, "free-until"> };

/* ------------------------------------------------------------------------------------------
 * Commission – percentage, fixed amount or none (decision 2026-11-08)
 * ---------------------------------------------------------------------------------------- */

export const COMMISSION_TYPES = ["none", "percent", "fixed"] as const;
export type CommissionType = (typeof COMMISSION_TYPES)[number];

export type CommissionModel =
  | { type: "none" }
  /** Basis points of the attributed revenue (1000 = 10 %). */
  | { type: "percent"; basisPoints: number }
  /** Fixed amount per booking. */
  | { type: "fixed"; amountCents: number; currency: string };

/** Commission for one attributed booking (integer cents, rounded half up). */
export function commissionCents(model: CommissionModel, revenueCents: number): number {
  if (!Number.isInteger(revenueCents) || revenueCents < 0) throw new RangeError("revenue");
  switch (model.type) {
    case "none":
      return 0;
    case "percent":
      return Math.round((revenueCents * model.basisPoints) / 10_000);
    case "fixed":
      return model.amountCents;
  }
}

/* ------------------------------------------------------------------------------------------
 * Availability (when an offer may be shown/recommended)
 * ---------------------------------------------------------------------------------------- */

export type OfferAvailability = {
  /** Journey phases in which the offer is shown at all. Empty = every phase but after-departure. */
  phases: readonly JourneyPhase[];
  /** Phases in which the offer is especially relevant (recommendation weight). */
  focusPhases: readonly JourneyPhase[];
  /** Seasons as "MM-DD" ranges (inclusive, may wrap the year). Empty = all year. */
  seasons: readonly { from: string; to: string }[];
  /** ISO weekdays 1 (Mon) – 7 (Sun) of the guest's local "today". Empty = every day. */
  weekdays: readonly number[];
  /** Shown from N days before arrival at the earliest (e.g. 14). Undefined = any time. */
  showFromDaysBeforeArrival?: number;
};

export const DEFAULT_AVAILABILITY: OfferAvailability = {
  phases: [],
  focusPhases: [],
  seasons: [],
  weekdays: [],
};

export type OfferStatus = GuideStatus;

/** A partner (local business) – optionally the EXPLORE place it is (address, map). */
export type Partner = {
  id: string;
  tenantId: string;
  name: string;
  status: "active" | "inactive";
  explorePlaceId?: string;
  websiteUrl?: string;
  /** Default commission; an offer may override it. */
  commission: CommissionModel;
};

export type Offer = {
  id: string;
  tenantId: string;
  kind: OfferKind;
  partnerId?: string;
  category: OfferCategory;
  status: OfferStatus;
  slug: LocalizedText;
  title: LocalizedText;
  /** One or two lines in lists and on the home page. */
  teaser: LocalizedText;
  /** Longer text; paragraphs separated by blank lines. */
  body?: LocalizedText;
  /** "Gut zu wissen": one line per item. */
  details?: LocalizedText;
  heroImage?: ContentImage;
  gallery: readonly ContentImage[];
  fulfillment: FulfillmentType;
  /** Partner booking page (fulfillment "link"). */
  bookingUrl?: string;
  /** Partner offers only; house services take price and availability from Extras. */
  price?: OfferPrice;
  durationMinutes?: number;
  cancellation: CancellationPolicy;
  /** Overrides the partner's default; house services: undefined. */
  commission?: CommissionModel;
  availability: OfferAvailability;
  featured: boolean;
  sortOrder: number;
  translationState: TranslationState;
};

/** An offer as assigned to one property (the reference to the Extras service is per property). */
export type PropertyOffer = Offer & {
  propertyId: string;
  /** Apaleo service id in the Extras catalog of this property (house services). */
  extrasServiceId?: string;
  propertySortOrder: number;
  partner?: Pick<Partner, "id" | "name" | "websiteUrl" | "commission"> & {
    locality?: string;
    address?: string;
  };
};

/** Commission that applies to an offer (offer override → partner default → none). */
export function effectiveCommission(offer: Pick<PropertyOffer, "commission" | "partner">) {
  return offer.commission ?? offer.partner?.commission ?? ({ type: "none" } as const);
}
