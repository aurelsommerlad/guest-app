import { type Visibility } from "../content/visibility";
import { type LocalizedText } from "../i18n/localized-text";

/**
 * GUIDE content model (digital guest folder).
 *
 * Shaped like the planned database tables: one row per section, blocks as an
 * ordered JSON array, translatable fields as LocalizedText ({ de, en, … }).
 * A future admin editor writes exactly this structure.
 */

/**
 * Where a guide entry applies: tenant default → property → unit.
 * Entries describing the same topic share a `key` (see resolveGuideSections, ADR 0013).
 */
export type ContentScope =
  | { level: "tenant" }
  | { level: "property"; propertyId: string }
  | { level: "unit"; propertyId: string; unitId: string };

/** Icon names available for guide sections (subset of the UI icon set). */
export type GuideIcon =
  | "car"
  | "wifi"
  | "home"
  | "plug"
  | "thermometer"
  | "trash"
  | "book-open"
  | "log-out"
  | "key"
  | "info";

/** An image stored with the content. `src` is a URL (storage later, bundled asset in mocks). */
export type ContentImage = {
  src: string;
  width: number;
  height: number;
  alt: LocalizedText;
  /** Optional low-quality placeholder (data URL). */
  blurDataUrl?: string;
};

type BlockBase = {
  id: string;
  /** Optional per-block visibility, e.g. a door code inside the arrival section. */
  visibility?: Visibility;
};

/** Content blocks – intentionally few, no page builder. */
export type GuideBlock = BlockBase &
  (
    | { type: "heading"; text: LocalizedText }
    | { type: "paragraph"; text: LocalizedText }
    | { type: "list"; style: "bullet" | "steps"; items: readonly LocalizedText[] }
    | { type: "callout"; title?: LocalizedText; text: LocalizedText }
    | { type: "image"; image: ContentImage; caption?: LocalizedText }
    | { type: "link"; label: LocalizedText; href: string }
    | { type: "action"; action: "phone" | "email" | "map"; label: LocalizedText; value: string }
  );

/** Editorial status: only `published` is ever shown to guests. */
export const GUIDE_STATUSES = ["draft", "published", "archived"] as const;
export type GuideStatus = (typeof GUIDE_STATUSES)[number];

export const GUIDE_ICONS = [
  "car",
  "wifi",
  "home",
  "plug",
  "thermometer",
  "trash",
  "book-open",
  "log-out",
  "key",
  "info",
] as const satisfies readonly GuideIcon[];

/** Languages content is maintained in; German is the editorial source language. */
export const CONTENT_LOCALES = ["de", "en"] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];
export const SOURCE_LOCALE: ContentLocale = "de";

/**
 * Per target language: where its translation stands. Prepared for a later
 * (AI-assisted) translation workflow – nothing sets "machine" yet.
 */
export type TranslationStatus = "missing" | "outdated" | "machine" | "reviewed";
export type TranslationState = Readonly<Partial<Record<ContentLocale, TranslationStatus>>>;

/** The content part of a topic – also what a unit override replaces. */
export type GuideContent = {
  /** Lead text on the detail page. */
  intro?: LocalizedText;
  heroImage?: ContentImage;
  blocks: readonly GuideBlock[];
};

type GuideEntryBase = GuideContent & {
  id: string;
  tenantId: string;
  /** Stable topic identity (e.g. "wifi"); topic and its overrides share it. */
  key: string;
  status: GuideStatus;
  translationState: TranslationState;
};

/**
 * A topic as the guest sees it in the GUIDE list: title, slug, icon, order and its
 * default content. Scope property = whole property, unit = only that apartment,
 * tenant = default for all properties.
 */
export type GuideTopic = GuideEntryBase & {
  kind: "topic";
  scope: ContentScope;
  sortOrder: number;
  icon: GuideIcon;
  slug: LocalizedText;
  eyebrow?: LocalizedText;
  title: LocalizedText;
  shortDescription: LocalizedText;
  visibility?: Visibility;
};

/**
 * Apartment-specific content for a topic of the same `key` (e.g. the Wi-Fi of ESL).
 * Replaces only the content; title, slug, icon and order always come from the topic.
 */
export type GuideOverride = GuideEntryBase & {
  kind: "override";
  scope: { level: "unit"; propertyId: string; unitId: string };
};

/** One stored row: a topic or an override. */
export type GuideEntry = GuideTopic | GuideOverride;

/** A resolved section, ready to render (always published). */
export type GuideSection = {
  id: string;
  tenantId: string;
  /** Stable topic identity across scopes (e.g. "arrival-parking"), basis for overrides. */
  key: string;
  scope: ContentScope;
  status: "draft" | "published";
  /** URL segment per locale, e.g. { de: "ankunft-parken", en: "arrival-parking" }. */
  slug: LocalizedText;
  /** Short label above the title on the detail page (e.g. "Ankunft"). */
  eyebrow?: LocalizedText;
  title: LocalizedText;
  shortDescription: LocalizedText;
  icon: GuideIcon;
  sortOrder: number;
  visibility?: Visibility;
  /** Lead text on the detail page. */
  intro?: LocalizedText;
  heroImage?: ContentImage;
  blocks: readonly GuideBlock[];
};
