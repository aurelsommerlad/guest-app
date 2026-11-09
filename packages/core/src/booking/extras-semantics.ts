/**
 * How the Extras app (aurelsommerlad/guest-services) actually interprets each stored
 * configuration value – reproduced 1:1 from its code, including its quirks.
 *
 * Purpose: the configuration parity check. The STAY import may deliberately correct a quirk
 * (P-1, P-2), but it must never change the meaning of a stored setting unnoticed. Comparing
 * these functions with STAY's own interpretation shows exactly where a stored value would
 * behave differently after the switch.
 *
 * Sources (guest-services, unchanged at 6c5e5af):
 * - lib/store.js getExtensionConfig / saveExtensionConfig
 * - lib/guest.js getGuestCatalog, placeGuestOrder
 * - lib/catalogLocalization.js, lib/priceDisplay.js, lib/catalogSort.js
 * - lib/unitGroupRestriction.js, lib/occupancyAmendment.js
 * - app/api/admin/catalog/route.js (what the admin form stores)
 * - components/guest/GuestApp.jsx (which fulfillment modes are shown)
 *
 * Nothing here is used to book anything.
 */

/** JavaScript truthiness – how Extras reads every catalog flag (`if (item.active)`). */
export function extrasTruthy(value: unknown): boolean {
  return Boolean(value);
}

/** `Number(v)` if finite, else undefined (lib/store.js toFiniteNumber). null, "", false → 0. */
export function extrasFiniteNumber(value: unknown): number | undefined {
  // Number() on objects/arrays is part of the original behaviour ([] → 0, [5] → 5).
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export type ExtrasExtensionConfig = {
  extensionNightEnabled: boolean;
  minSellableStayNights: number;
  extensionDiscountPreArrivalOneNightGap: number;
  extensionDiscountPreArrivalStandard: number;
  extensionDiscountInHouseOneNightGap: number;
  extensionDiscountInHouseStandard: number;
};

const EXTRAS_EXTENSION_DEFAULTS = {
  extensionNightEnabled: false,
  extensionDiscountOneNightGap: 20,
  extensionDiscountStandard: 15,
  extensionDiscountPreArrivalOneNightGap: 15,
  extensionDiscountPreArrivalStandard: 10,
  extensionDiscountInHouseOneNightGap: 20,
  extensionDiscountInHouseStandard: 15,
  minSellableStayNights: 2,
} as const;

/** lib/store.js getExtensionConfig – `Boolean(stored ?? false)`, three-way discount fallback. */
export function extrasExtensionConfig(
  stored: Record<string, unknown> | null | undefined,
): ExtrasExtensionConfig {
  const s = stored ?? {};
  const legacyOne = extrasFiniteNumber(s.extensionDiscountOneNightGap);
  const legacyStd = extrasFiniteNumber(s.extensionDiscountStandard);
  const own = (key: string) => extrasFiniteNumber(s[key]);
  return {
    extensionNightEnabled: Boolean(
      s.extensionNightEnabled ?? EXTRAS_EXTENSION_DEFAULTS.extensionNightEnabled,
    ),
    minSellableStayNights:
      own("minSellableStayNights") ?? EXTRAS_EXTENSION_DEFAULTS.minSellableStayNights,
    extensionDiscountPreArrivalOneNightGap:
      own("extensionDiscountPreArrivalOneNightGap") ??
      legacyOne ??
      EXTRAS_EXTENSION_DEFAULTS.extensionDiscountPreArrivalOneNightGap,
    extensionDiscountPreArrivalStandard:
      own("extensionDiscountPreArrivalStandard") ??
      legacyStd ??
      EXTRAS_EXTENSION_DEFAULTS.extensionDiscountPreArrivalStandard,
    extensionDiscountInHouseOneNightGap:
      own("extensionDiscountInHouseOneNightGap") ??
      legacyOne ??
      EXTRAS_EXTENSION_DEFAULTS.extensionDiscountInHouseOneNightGap,
    extensionDiscountInHouseStandard:
      own("extensionDiscountInHouseStandard") ??
      legacyStd ??
      EXTRAS_EXTENSION_DEFAULTS.extensionDiscountInHouseStandard,
  };
}

/**
 * Whether Extras can ever show an extension offer with this config: enabled, and
 * lib/stayExtension.js decideExtensionOffer does not answer "invalid_config"
 * (minSellableStayNights finite and ≥ 1). A stored minimum of null, "" or 0 therefore
 * switches the offer off in Extras even though the switch is on.
 */
export function extrasExtensionEffectivelyEnabled(config: ExtrasExtensionConfig): boolean {
  return config.extensionNightEnabled && config.minSellableStayNights >= 1;
}

/**
 * Additional guest price per night as Extras uses it (lib/occupancyAmendment.js
 * buildExtraPersonPricing: `Number(v)`, finite and ≥ 0). null and "" become 0 € – the item is
 * shown for free (the P-2 case). Returns null when Extras hides the item.
 */
export function extrasExtraPersonPrice(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * STAY's "without order": after every numbered service, as Extras sorts an empty order.
 * 9999 is also the highest order the STAY admin accepts.
 */
export const SORT_ORDER_LAST = 9999;

/** lib/catalogSort.js – only real finite numbers count; everything else sorts last. */
export function extrasSortKey(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

/**
 * Which guest flow an item reaches (GuestApp.jsx: instant list = `(mode || "instant") ===
 * "instant"`, request list = `mode === "request"`). Any other value is shown in neither list.
 */
export function extrasFulfillmentReach(value: unknown): "instant" | "request" | "hidden" {
  const mode = value || "instant";
  if (mode === "instant") return "instant";
  if (mode === "request") return "request";
  return "hidden";
}

/** lib/guest.js: `actionType === "increase_occupancy"`, everything else is a service. */
export function extrasActionType(value: unknown): "service" | "increase_occupancy" {
  return value === "increase_occupancy" ? "increase_occupancy" : "service";
}

/** lib/guest.js resolveRequiredDates: unknown or empty rules fall through to per_stay. */
export function extrasBookingRule(
  value: unknown,
): "per_stay" | "per_night" | "arrival_day" | "departure_day" {
  return value === "per_night" || value === "arrival_day" || value === "departure_day"
    ? value
    : "per_stay";
}

/**
 * lib/unitGroupRestriction.js: a non-array or empty list is unrestricted; otherwise only
 * exact members match (a non-string entry never matches anything).
 */
export function extrasUnitGroupRestriction(
  value: unknown,
): { restricted: false } | { restricted: true; allowed: string[]; unmatchable: number } {
  if (!Array.isArray(value) || value.length === 0) return { restricted: false };
  const allowed = value.filter((v): v is string => typeof v === "string");
  return { restricted: true, allowed, unmatchable: value.length - allowed.length };
}

const trimText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * Guest-facing title / description in Extras (lib/catalogLocalization.js
 * resolveBilingualText): curated language override → Apaleo text in that language → Apaleo
 * text in the other language → the generic curated field → last resort.
 */
export function extrasResolveText(input: {
  overrideDe: unknown;
  overrideEn: unknown;
  apaleoDe?: string | null;
  apaleoEn?: string | null;
  generic: unknown;
  finalFallback: string;
}): { de: string; en: string } {
  const pick = (lang: "de" | "en") => {
    const override = trimText(lang === "de" ? input.overrideDe : input.overrideEn);
    if (override) return override;
    const same = trimText(lang === "de" ? input.apaleoDe : input.apaleoEn);
    if (same) return same;
    const other = trimText(lang === "de" ? input.apaleoEn : input.apaleoDe);
    if (other) return other;
    const generic = trimText(input.generic);
    if (generic) return generic;
    return input.finalFallback;
  };
  return { de: pick("de"), en: pick("en") };
}

/** lib/priceDisplay.js defaults per booking rule (the additional guest uses its own key). */
export const EXTRAS_PRICE_UNIT_DEFAULTS = {
  de: {
    per_night: "pro Nacht",
    per_stay: "pro Aufenthalt",
    arrival_day: "einmalig",
    departure_day: "einmalig",
    per_person_per_night: "pro Person / Nacht",
  },
  en: {
    per_night: "per night",
    per_stay: "per stay",
    arrival_day: "one-time",
    departure_day: "one-time",
    per_person_per_night: "per person / night",
  },
} as const;

/**
 * Price unit label in Extras: language override → the generic label (in whatever language it
 * was typed, for BOTH languages) → default of the booking rule. An unknown rule has no default.
 */
export function extrasResolvePriceUnitLabel(input: {
  overrideDe: unknown;
  overrideEn: unknown;
  generic: unknown;
  bookingRule: unknown;
}): { de: string; en: string } {
  const pick = (lang: "de" | "en") => {
    const specific = trimText(lang === "de" ? input.overrideDe : input.overrideEn);
    if (specific) return specific;
    const generic = trimText(input.generic);
    if (generic) return generic;
    const table = EXTRAS_PRICE_UNIT_DEFAULTS[lang] as Record<string, string>;
    return typeof input.bookingRule === "string" ? (table[input.bookingRule] ?? "") : "";
  };
  return { de: pick("de"), en: pick("en") };
}

/** The Extras text fields of one catalog item (verbatim, trimmed; empty fields omitted). */
export type ExtrasTexts = Partial<
  Record<
    | "displayName"
    | "displayNameDe"
    | "displayNameEn"
    | "description"
    | "descriptionDe"
    | "descriptionEn"
    | "priceUnitLabel"
    | "priceUnitLabelDe"
    | "priceUnitLabelEn"
    | "code",
    string
  >
>;

/**
 * Guest texts of an imported item exactly as Extras shows them (lib/guest.js getGuestCatalog
 * pass 2): title and description from the curated overrides, then Apaleo's localized texts,
 * then the generic fields; the price unit label from its overrides, the generic label and the
 * booking rule's default. The additional guest uses its own "per person / night" default.
 */
export function resolveExtrasCatalogTexts(input: {
  texts: ExtrasTexts;
  apaleo: {
    name: { de?: string | null; en?: string | null };
    description: { de?: string | null; en?: string | null };
  } | null;
  serviceId: string;
  bookingRule: string;
  actionType: string;
}): {
  displayName: { de: string; en: string };
  description: { de: string; en: string };
  priceUnitLabel: { de: string; en: string };
} {
  const { texts, apaleo } = input;
  return {
    displayName: extrasResolveText({
      overrideDe: texts.displayNameDe,
      overrideEn: texts.displayNameEn,
      apaleoDe: apaleo?.name.de,
      apaleoEn: apaleo?.name.en,
      generic: texts.displayName,
      finalFallback: texts.code || input.serviceId,
    }),
    description: extrasResolveText({
      overrideDe: texts.descriptionDe,
      overrideEn: texts.descriptionEn,
      apaleoDe: apaleo?.description.de,
      apaleoEn: apaleo?.description.en,
      generic: texts.description,
      finalFallback: "",
    }),
    priceUnitLabel: extrasResolvePriceUnitLabel({
      overrideDe: texts.priceUnitLabelDe,
      overrideEn: texts.priceUnitLabelEn,
      generic: texts.priceUnitLabel,
      bookingRule:
        input.actionType === "increase_occupancy" ? "per_person_per_night" : input.bookingRule,
    }),
  };
}
