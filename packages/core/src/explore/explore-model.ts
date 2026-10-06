import { type ContentImage, type GuideStatus, type TranslationState } from "../guide/guide-model";
import { type LocalizedText } from "../i18n/localized-text";

/**
 * EXPLORE (ADR 0015): places personally recommended by the operator around a property.
 * Curated content from the admin – not fed by any external places API.
 */

/**
 * Fixed, central taxonomy (DB check constraint + labels in the app messages). A new
 * category is one entry here, a migration extending the check, and two labels.
 */
export const EXPLORE_CATEGORIES = [
  "food-drink",
  "nature",
  "activities",
  "wellness",
  "shopping",
  "sights",
] as const;
export type ExploreCategory = (typeof EXPLORE_CATEGORIES)[number];

/** Filter value on the guest overview: a category or all of them. */
export const EXPLORE_FILTERS = ["all", ...EXPLORE_CATEGORIES] as const;
export type ExploreFilter = (typeof EXPLORE_FILTERS)[number];

/** Same lifecycle as GUIDE: draft (internal) → published (live) → archived (hidden). */
export type ExploreStatus = GuideStatus;

export type ExplorePlace = {
  id: string;
  tenantId: string;
  status: ExploreStatus;
  category: ExploreCategory;
  /** URL segment per locale (German required). */
  slug: LocalizedText;
  title: LocalizedText;
  /** One or two lines on the card. */
  teaser: LocalizedText;
  /** Longer description; paragraphs separated by blank lines. */
  description?: LocalizedText;
  /** Personal tip of UNIQUE PLACES ("Unser Tipp"). */
  tip?: LocalizedText;
  /** Editorial hint, e.g. "Mi–So ab 17 Uhr" – no structured opening hours. */
  openingHours?: LocalizedText;
  heroImage?: ContentImage;
  /** Postal address, one line per row. */
  address?: string;
  /** Place name shown on the card, e.g. "Lindau". */
  locality?: string;
  mapsUrl?: string;
  websiteUrl?: string;
  phone?: string;
  reservationUrl?: string;
  sortOrder: number;
  /** Highlights come first and get the larger card. */
  featured: boolean;
  /** Properties the place is recommended for. Empty = shown nowhere. */
  propertyIds: readonly string[];
  translationState: TranslationState;
};
