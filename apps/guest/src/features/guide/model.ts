import { type GuideIcon } from "@up/core";

/** View models of the GUIDE screens – resolved for one locale. */

export type GuideOverviewItem = {
  id: string;
  /** Locale-less app path, e.g. "/guide/ankunft-parken". */
  href: string;
  title: string;
  description: string;
  icon: GuideIcon;
};

export type ResolvedImage = {
  src: string;
  width: number;
  height: number;
  alt: string;
  blurDataUrl?: string;
};

export type ResolvedBlock =
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "paragraph"; text: string }
  | { id: string; type: "list"; style: "bullet" | "steps"; items: string[] }
  | { id: string; type: "callout"; title?: string; text: string }
  | { id: string; type: "image"; image: ResolvedImage; caption?: string }
  | { id: string; type: "link"; label: string; href: string }
  | { id: string; type: "action"; action: "phone" | "email" | "map"; label: string; value: string };

export type GuideArticle = {
  id: string;
  title: string;
  eyebrow?: string;
  intro?: string;
  heroImage?: ResolvedImage;
  blocks: ResolvedBlock[];
};
