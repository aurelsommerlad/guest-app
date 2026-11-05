/**
 * VAT identification numbers (USt-IdNr. / UID) – format only (ADR 0021). A matching format
 * says nothing about whether the number exists or belongs to the company; that is what the
 * (optional, non-blocking) VIES lookup is for, and the qualified confirmation stays with
 * accounting.
 */
// After the 2-letter prefix; Greece uses "EL", Northern Ireland "XI".
const VAT_PATTERNS: Readonly<Record<string, RegExp>> = {
  AT: /^U\d{8}$/,
  BE: /^[01]\d{9}$/,
  BG: /^\d{9,10}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  EL: /^\d{9}$/,
  ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^\d{8}$/,
  FR: /^[A-HJ-NP-Z0-9]{2}\d{9}$/,
  HR: /^\d{11}$/,
  HU: /^\d{8}$/,
  IE: /^(\d{7}[A-W][A-I]?|\d[A-Z+*]\d{5}[A-W])$/,
  IT: /^\d{11}$/,
  LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  LV: /^\d{11}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^\d{2,10}$/,
  SE: /^\d{10}01$/,
  SI: /^\d{8}$/,
  SK: /^\d{10}$/,
  XI: /^(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
  // Not checkable in VIES:
  CH: /^E\d{9}(MWST|TVA|IVA)?$/,
  GB: /^(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
};

/** Prefixes VIES can answer for (EU member states + Northern Ireland). */
export const VIES_PREFIXES: ReadonlySet<string> = new Set(
  Object.keys(VAT_PATTERNS).filter((prefix) => prefix !== "CH" && prefix !== "GB"),
);

export type VatIdFormat =
  | { ok: true; prefix: string; number: string; normalized: string; viesCheckable: boolean }
  | { ok: false; reason: "invalid-format" | "unknown-prefix" };

/** "de 123 456 789" → "DE123456789"; "CHE-123.456.789 MWST" → "CHE123456789MWST". */
export function normalizeVatId(value: string): string {
  return value.toUpperCase().replace(/[\s.\-/]/g, "");
}

export function checkVatIdFormat(value: string): VatIdFormat {
  const normalized = normalizeVatId(value);
  const prefix = normalized.slice(0, 2);
  const number = normalized.slice(2);
  const pattern = VAT_PATTERNS[prefix];
  if (!/^[A-Z]{2}$/.test(prefix) || !pattern) return { ok: false, reason: "unknown-prefix" };
  if (!pattern.test(number)) return { ok: false, reason: "invalid-format" };
  return { ok: true, prefix, number, normalized, viesCheckable: VIES_PREFIXES.has(prefix) };
}

export const VAT_ID_STATUSES = [
  "not-provided",
  "format-valid",
  "vies-valid",
  "vies-invalid",
  "vies-unavailable",
  "not-checkable",
] as const;
export type VatIdStatus = (typeof VAT_ID_STATUSES)[number];

/** Port for the EU VIES service (public, no contract). Expected failures are returned. */
export interface VatIdChecker {
  check(input: {
    prefix: string;
    number: string;
  }): Promise<
    | { ok: true; valid: boolean; checkedAt: Date }
    | { ok: false; reason: "unavailable" | "rate-limited" }
  >;
}

/** Status after an (optional) VIES answer. A VIES outage never blocks the guest. */
export function vatIdStatus(
  format: VatIdFormat | undefined,
  vies?: { ok: true; valid: boolean } | { ok: false },
): VatIdStatus | "format-invalid" {
  if (!format) return "not-provided";
  if (!format.ok) return "format-invalid";
  if (!format.viesCheckable) return "not-checkable";
  if (!vies) return "format-valid";
  if (!vies.ok) return "vies-unavailable";
  return vies.valid ? "vies-valid" : "vies-invalid";
}
