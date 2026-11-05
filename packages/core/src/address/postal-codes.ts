/**
 * Postal code formats per country (ADR 0021, "formal gültig"). Only the *shape* is checked –
 * a matching code does not mean that it exists or belongs to the city.
 *
 * Countries not listed get the generic check of the registration model only. Countries in
 * POSTAL_CODE_NOT_USED have no (or no generally used) postal codes, so the field is optional.
 */
// Patterns operate on the normalised value: uppercase, single spaces, trimmed.
export const POSTAL_CODE_PATTERNS: Readonly<Record<string, RegExp>> = {
  DE: /^\d{5}$/,
  AT: /^\d{4}$/,
  CH: /^\d{4}$/,
  LI: /^\d{4}$/,
  FR: /^\d{5}$/,
  MC: /^980\d{2}$/,
  IT: /^\d{5}$/,
  SM: /^4789\d$/,
  ES: /^\d{5}$/,
  PT: /^\d{4}-\d{3}$/,
  NL: /^\d{4} ?[A-Z]{2}$/,
  BE: /^\d{4}$/,
  LU: /^(L-)?\d{4}$/,
  DK: /^\d{4}$/,
  SE: /^\d{3} ?\d{2}$/,
  NO: /^\d{4}$/,
  FI: /^\d{5}$/,
  IS: /^\d{3}$/,
  PL: /^\d{2}-\d{3}$/,
  CZ: /^\d{3} ?\d{2}$/,
  SK: /^\d{3} ?\d{2}$/,
  HU: /^\d{4}$/,
  SI: /^\d{4}$/,
  HR: /^\d{5}$/,
  GR: /^\d{3} ?\d{2}$/,
  RO: /^\d{6}$/,
  BG: /^\d{4}$/,
  EE: /^\d{5}$/,
  LV: /^(LV-)?\d{4}$/,
  LT: /^(LT-)?\d{5}$/,
  CY: /^\d{4}$/,
  MT: /^[A-Z]{3} ?\d{4}$/,
  GB: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/,
  IE: /^[A-Z]\d[\dW] ?[\dA-Z]{4}$/,
  US: /^\d{5}(-\d{4})?$/,
  CA: /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/,
  AU: /^\d{4}$/,
  NZ: /^\d{4}$/,
  JP: /^\d{3}-?\d{4}$/,
};

/** Countries without (generally used) postal codes: the field may stay empty. */
export const POSTAL_CODE_NOT_USED: ReadonlySet<string> = new Set([
  "AE",
  "AG",
  "AW",
  "BS",
  "BZ",
  "CW",
  "FJ",
  "GH",
  "HK",
  "JM",
  "MO",
  "QA",
  "ZW",
]);

/** Uppercase, single spaces, trimmed. */
export function normalizePostalCode(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().toUpperCase();
}

export type PostalCodeCheck = "ok" | "missing" | "invalid-format" | "not-checked";

/**
 * Shape check for one country. "not-checked" = no pattern known (generic rules apply);
 * "missing" is only reported where the country uses postal codes.
 */
export function checkPostalCode(country: string, postalCode: string | undefined): PostalCodeCheck {
  const value = postalCode === undefined ? "" : normalizePostalCode(postalCode);
  if (value === "") return POSTAL_CODE_NOT_USED.has(country) ? "ok" : "missing";
  const pattern = POSTAL_CODE_PATTERNS[country];
  if (!pattern) return "not-checked";
  return pattern.test(value) ? "ok" : "invalid-format";
}
