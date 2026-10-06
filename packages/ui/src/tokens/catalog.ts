/**
 * Catalog of design tokens for documentation (Design Lab).
 *
 * Contains names and roles only – the values live exclusively in styles/tokens.css
 * and are read at runtime via getComputedStyle. This keeps a single source of truth.
 */

export type ColorToken = {
  /** CSS custom property, e.g. "--up-base-sage" */
  variable: `--up-${string}`;
  name: string;
  role: string;
};

export const baseColorTokens: readonly ColorToken[] = [
  { variable: "--up-base-sand", name: "background", role: "Seitenhintergrund" },
  { variable: "--up-base-linen", name: "card", role: "Tiles, Cards" },
  {
    variable: "--up-base-sage",
    name: "primary",
    role: "Charakteristische Farbfläche, groß & dekorativ",
  },
  {
    variable: "--up-base-sage-dark",
    name: "primary-dark",
    role: "Links, kleine Akzenttexte",
  },
  { variable: "--up-base-ink", name: "text", role: "Headlines, Fließtext" },
  { variable: "--up-base-night", name: "cta", role: "Primäre Call-to-Action-Buttons" },
  { variable: "--up-base-ochre", name: "ochre", role: "Warmer Akzent, nur kleine Markierungen" },
  { variable: "--up-base-stone", name: "text-secondary", role: "Sekundärtext, Meta-Informationen" },
  { variable: "--up-base-mist", name: "border", role: "Haarlinien, Outline-Buttons" },
  { variable: "--up-base-chalk", name: "white", role: "Text auf Fotos & Flächen, gehobene Cards" },
];

export const semanticColorTokens: readonly ColorToken[] = [
  { variable: "--up-color-background", name: "background", role: "Seite" },
  { variable: "--up-color-surface", name: "surface", role: "Standard-Card (Linen)" },
  {
    variable: "--up-color-surface-raised",
    name: "surface-raised",
    role: "Listen-Cards, Kreis-Buttons auf Fotos",
  },
  { variable: "--up-color-surface-accent", name: "surface-accent", role: "Salbei-Akzentfläche" },
  {
    variable: "--up-color-surface-inverse",
    name: "surface-inverse",
    role: "Hervorgehobener Navigationspunkt",
  },
  { variable: "--up-color-text", name: "text", role: "Primärer Text" },
  { variable: "--up-color-text-muted", name: "text-muted", role: "Sekundärer Text" },
  {
    variable: "--up-color-text-inverse",
    name: "text-inverse",
    role: "Text auf Fotos, Akzent & Ink",
  },
  { variable: "--up-color-cta", name: "cta", role: "Primärer Button (Call to Action)" },
  { variable: "--up-color-on-cta", name: "on-cta", role: "Text auf cta" },
  { variable: "--up-color-action", name: "action", role: "Links, kleine Akzenttexte" },
  {
    variable: "--up-color-status-published",
    name: "status-published",
    role: "Status „Veröffentlicht“",
  },
  { variable: "--up-color-status-draft", name: "status-draft", role: "Status „Entwurf“" },
  { variable: "--up-color-status-archived", name: "status-archived", role: "Status „Archiviert“" },
  {
    variable: "--up-color-surface-sage",
    name: "surface-sage",
    role: "Sanfte Salbeifläche (Check-in, Erfolg)",
  },
  {
    variable: "--up-color-success",
    name: "success",
    role: "Erledigt-/Aktiv-Markierung, Fortschritt",
  },
  { variable: "--up-color-border", name: "border", role: "Linien" },
  { variable: "--up-color-focus", name: "focus", role: "Fokusrahmen (Tastatur)" },
];

/** Foreground/background pairs that occur in the reference, checked against WCAG. */
export const contrastPairs: readonly {
  fg: ColorToken["variable"];
  bg: ColorToken["variable"];
  usage: string;
  largeTextOnly?: boolean;
}[] = [
  { fg: "--up-color-text", bg: "--up-color-background", usage: "Text auf Hintergrund" },
  {
    fg: "--up-color-text-muted",
    bg: "--up-color-background",
    usage: "Sekundärtext auf Hintergrund",
  },
  { fg: "--up-color-text-muted", bg: "--up-color-surface", usage: "Sekundärtext auf Card" },
  { fg: "--up-color-action", bg: "--up-color-background", usage: "Link/Action auf Hintergrund" },
  { fg: "--up-color-on-cta", bg: "--up-color-cta", usage: "Button-Text auf cta" },
  {
    fg: "--up-color-on-status-published",
    bg: "--up-color-status-published",
    usage: "Status „Veröffentlicht“",
  },
  { fg: "--up-color-text", bg: "--up-color-status-draft", usage: "Status „Entwurf“" },
  { fg: "--up-color-text-muted", bg: "--up-color-status-archived", usage: "Status „Archiviert“" },
  { fg: "--up-color-on-cta", bg: "--up-color-cta-hover", usage: "Button-Text auf cta (Hover)" },
  {
    fg: "--up-color-text-inverse",
    bg: "--up-color-surface-accent",
    usage: "Weiß auf Salbei (Apartment-Tile)",
    largeTextOnly: true,
  },
  { fg: "--up-color-text-inverse", bg: "--up-color-surface-inverse", usage: "Weiß auf Ink (STAY)" },
  { fg: "--up-color-text", bg: "--up-color-surface-sage", usage: "Text auf Salbeifläche" },
  {
    fg: "--up-color-text-muted",
    bg: "--up-color-surface-sage",
    usage: "Sekundärtext auf Salbeifläche",
  },
  { fg: "--up-color-success", bg: "--up-color-surface-sage", usage: "Häkchen auf Salbeifläche" },
  { fg: "--up-color-on-success", bg: "--up-color-success", usage: "Häkchen im Erledigt-Punkt" },
];

export type TypeStyle = {
  utility: `type-${string}`;
  name: string;
  family: "Josefin Sans" | "Roboto";
  spec: string;
  usage: string;
};

/** Mirrors the @utility definitions in styles/theme.css (documentation only). */
export const typeStyles: readonly TypeStyle[] = [
  {
    utility: "type-display",
    name: "Display",
    family: "Josefin Sans",
    spec: "32 / 36 · 350 · < 360 px: 28 · Desktop 44 / 48",
    usage: "Begrüßung, Seiten-Hero",
  },
  {
    utility: "type-title-lg",
    name: "Title Large",
    family: "Josefin Sans",
    spec: "28 / 32 · 350 · Desktop 36 / 41",
    usage: "Seitentitel (Guide, WLAN, Check-out)",
  },
  {
    utility: "type-title",
    name: "Title",
    family: "Josefin Sans",
    spec: "17 / 22 · Regular 400",
    usage: "Card-Titel auf Fotos, Listentitel",
  },
  {
    utility: "type-figure",
    name: "Figure",
    family: "Josefin Sans",
    spec: "32 / 32 · 350",
    usage: "Kennzahlen in Tiles (10:00, ROS)",
  },
  {
    utility: "type-brand",
    name: "Brand",
    family: "Josefin Sans",
    spec: "13 / 18 · Regular 400 · +0.02em",
    usage: "Property & Ort im Header",
  },
  {
    utility: "type-eyebrow",
    name: "Eyebrow",
    family: "Josefin Sans",
    spec: "11 / 14 · Regular 400 · +0.03em · VERSAL",
    usage: "Labels (CHECK-OUT, APARTMENT)",
  },
  {
    utility: "type-nav",
    name: "Navigation",
    family: "Josefin Sans",
    spec: "11 / 13 · Medium 500 · +0.04em · VERSAL",
    usage: "GUIDE · STAY · EXPLORE",
  },
  {
    utility: "type-lead",
    name: "Lead",
    family: "Roboto",
    spec: "15 / 19.5 · Regular 400",
    usage: "Subline unter der Begrüßung",
  },
  {
    utility: "type-body",
    name: "Body",
    family: "Roboto",
    spec: "15 / 22.5 · Regular 400",
    usage: "Fließtext, Artikel",
  },
  {
    utility: "type-small",
    name: "Small",
    family: "Roboto",
    spec: "14 / 19.6 · Regular 400",
    usage: "Datum, Links, Card-Sublines",
  },
  {
    utility: "type-caption",
    name: "Caption",
    family: "Roboto",
    spec: "13 / 18 · Regular 400",
    usage: "Listenbeschreibungen, Hinweise",
  },
];

export const spacingScale = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20] as const;

export const radiusTokens = [
  { variable: "--up-radius-sm", utility: "rounded-sm", usage: "Badges, Chips" },
  { variable: "--up-radius-control", utility: "rounded-control", usage: "Buttons, Eingabefelder" },
  { variable: "--up-radius-card", utility: "rounded-card", usage: "Tiles, Cards, Bilder" },
  { variable: "--up-radius-full", utility: "rounded-full", usage: "Kreis-Buttons, Navigation" },
] as const;
