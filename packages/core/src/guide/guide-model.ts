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
 * Where a section applies. Planned inheritance (not implemented yet):
 * tenant default → property content → unit-specific addition/override.
 * Sections describing the same topic share a `key`; the most specific scope will win.
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
