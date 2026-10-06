import { type ExploreCategory } from "@up/core";

import { type ResolvedImage } from "../guide/model";

/** View models of the EXPLORE screens – resolved for one locale. */

export type ExploreCard = {
  id: string;
  /** Locale-less app path, e.g. "/explore/seecafe". */
  href: string;
  title: string;
  teaser: string;
  category: ExploreCategory;
  locality?: string;
  featured: boolean;
  /** Places without a title image get a calm graphic panel instead. */
  image?: ResolvedImage;
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
  image?: ResolvedImage;
  teaser: string;
  tip?: string;
  /** Paragraphs of the description. */
  description: string[];
  openingHours?: string;
  /** Address lines as entered. */
  address?: string[];
  actions: PlaceAction[];
};
