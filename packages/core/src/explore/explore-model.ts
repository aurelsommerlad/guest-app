import { type Visibility } from "../content/visibility";
import { type ContentImage } from "../guide/guide-model";
import { type LocalizedText } from "../i18n/localized-text";

/**
 * EXPLORE content model: places personally recommended by the operator.
 * Shaped like future database rows; not fed by any external places API.
 */

/** Central category list. Extend here (plus DE/EN labels in the app messages). */
export const EXPLORE_CATEGORIES = ["food-drink", "nature", "active", "culture", "family"] as const;
export type ExploreCategory = (typeof EXPLORE_CATEGORIES)[number];

/** Filter value on the overview: a category or all of them. */
export const EXPLORE_FILTERS = ["all", ...EXPLORE_CATEGORIES] as const;
export type ExploreFilter = (typeof EXPLORE_FILTERS)[number];

/**
 * Where a place is recommended. One place can belong to several properties
 * (e.g. a Lake Constance trip for LÆKE and HØV). Planned table: place_properties.
 */
export type PlaceScope =
  { level: "tenant" } | { level: "properties"; propertyIds: readonly string[] };

export type GeoCoordinates = { lat: number; lng: number };

export type ExplorePlace = {
  id: string;
  tenantId: string;
  scope: PlaceScope;
  status: "draft" | "published";
  /** URL segment per locale. */
  slug: LocalizedText;
  title: LocalizedText;
  /** Main category first; a place may appear under several filters. */
  categories: readonly [ExploreCategory, ...ExploreCategory[]];
  /** One line on the overview card. */
  shortDescription: LocalizedText;
  /** The personal recommendation – why we like it. */
  recommendation?: LocalizedText;
  /** Longer description, one entry per paragraph. */
  description?: readonly LocalizedText[];
  /** Optional hint ("Gut zu wissen"). */
  goodToKnow?: LocalizedText;
  /** First image is the cover. */
  images: readonly [ContentImage, ...ContentImage[]];
  address?: { street?: string; postalCode?: string; city?: string };
  coordinates?: GeoCoordinates;
  website?: string;
  phone?: string;
  /** Free text per locale, e.g. "Mi–So ab 17:00 Uhr" – structured hours come later if needed. */
  openingHours?: LocalizedText;
  bookingUrl?: string;
  sortOrder: number;
  /** Featured places come first and get the larger card. */
  featured: boolean;
  visibility?: Visibility;
};
