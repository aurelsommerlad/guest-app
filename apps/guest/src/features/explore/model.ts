import { type ExploreCategory } from "@up/core";

import { type ResolvedImage } from "../guide/model";

/** View models of the EXPLORE screens – resolved for one locale. */

export type ExploreIntro = { title: string; lead: string };

export type ExploreCard = {
  id: string;
  /** Locale-less app path, e.g. "/explore/beispiel-gasthaus". */
  href: string;
  title: string;
  description: string;
  categories: readonly ExploreCategory[];
  featured: boolean;
  image: ResolvedImage;
};

export type PlaceAction = {
  kind: "route" | "website" | "call" | "reserve";
  href: string;
  /** Opens outside the app (maps, website, booking). */
  external: boolean;
};

export type PlaceDetail = {
  id: string;
  title: string;
  category: ExploreCategory;
  image: ResolvedImage;
  recommendation?: string;
  description: string[];
  goodToKnow?: string;
  openingHours?: string;
  /** Address lines, e.g. ["Beispielweg 1", "00000 Musterort"]. */
  address?: string[];
  phone?: string;
  actions: PlaceAction[];
};
