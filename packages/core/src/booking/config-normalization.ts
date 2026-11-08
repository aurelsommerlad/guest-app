/**
 * Normalization and validation of service configuration values (M2). Used by the Extras
 * import and the STAY admin – one rule set, so imported and edited data behave the same.
 *
 * Decisions (08.11.2026):
 * - Additional guests without a valid price are never booked for free; the configuration is
 *   flagged as an error and the service is not bookable until a price is set.
 * - Empty extension discounts count as 0 %; only a MISSING field falls back to an explicitly
 *   defined value (legacy flat field, then the documented default).
 * - Historic boolean values such as "true" are normalized; the import reports it.
 * - Licence plates are stored as validated text.
 */

/** Values that historic records use for "true". Everything else is false. */
const TRUE_VALUES = new Set(["true", "1", "yes", "ja", "on"]);

export function normalizeBoolean(value: unknown): { value: boolean; normalized: boolean } {
  if (typeof value === "boolean") return { value, normalized: false };
  if (value === undefined || value === null) return { value: false, normalized: false };
  const text =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value.trim().toLowerCase()
        : "";
  return { value: TRUE_VALUES.has(text), normalized: true };
}

/* ── Licence plates ──────────────────────────────────────────────────────────────────── */

/** Letters (incl. umlauts), digits, space and hyphen; 2–12 characters after normalizing. */
export const VEHICLE_PLATE_PATTERN = /^[A-Z0-9ÄÖÜ][A-Z0-9ÄÖÜ -]{0,10}[A-Z0-9ÄÖÜ]$/;

/** Uppercase, single spaces, trimmed – or null if it is not a plausible plate. */
export function normalizeVehiclePlate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toUpperCase().replace(/\s+/g, " ");
  return VEHICLE_PLATE_PATTERN.test(text) ? text : null;
}

/* ── Configuration issues ────────────────────────────────────────────────────────────── */

export const SERVICE_CONFIG_ISSUES = [
  "missing_apaleo_service",
  "missing_extra_person_price",
  "invalid_extra_person_price",
  "occupancy_requires_instant",
  "occupancy_requires_capacity_rule",
] as const;
export type ServiceConfigIssue = (typeof SERVICE_CONFIG_ISSUES)[number];

export const SERVICE_CONFIG_ISSUE_LABELS: Record<ServiceConfigIssue, string> = {
  missing_apaleo_service: "Kein Apaleo-Service zugeordnet – nicht buchbar.",
  missing_extra_person_price:
    "Zusatzperson ohne Preis – nicht buchbar (wird nie kostenlos gebucht).",
  invalid_extra_person_price: "Ungültiger Preis für die Zusatzperson – nicht buchbar.",
  occupancy_requires_instant: "Zusatzpersonen werden immer sofort gebucht.",
  occupancy_requires_capacity_rule: "Zusatzpersonen brauchen die Kapazitätsregel.",
};

export type ServiceConfigLike = {
  extrasServiceId?: string | null;
  actionType?: string | null;
  fulfillment?: string | null;
  extraPersonPriceCents?: number | null;
  requiresRemainingCapacity?: boolean;
};

/** Errors that make a property configuration of an own service not bookable. */
export function serviceConfigIssues(config: ServiceConfigLike): ServiceConfigIssue[] {
  const issues: ServiceConfigIssue[] = [];
  if (!config.extrasServiceId) issues.push("missing_apaleo_service");
  if (config.actionType === "increase_occupancy") {
    const price = config.extraPersonPriceCents;
    if (price === null || price === undefined) issues.push("missing_extra_person_price");
    else if (!Number.isInteger(price) || price < 0) issues.push("invalid_extra_person_price");
    if (config.fulfillment && config.fulfillment !== "instant")
      issues.push("occupancy_requires_instant");
    if (config.requiresRemainingCapacity === false) issues.push("occupancy_requires_capacity_rule");
  }
  return issues;
}

export function isBookableConfig(config: ServiceConfigLike): boolean {
  return serviceConfigIssues(config).length === 0;
}

/* ── Price parsing (admin forms, import) ─────────────────────────────────────────────── */

/** "35", "35,50", 35.5 → cents; empty → null; anything else → NaN (invalid). */
export function parsePriceToCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number")
    return Number.isFinite(value) ? Math.round(value * 100) : Number.NaN;
  if (typeof value !== "string") return Number.NaN;
  const text = value.trim().replace(/\s/g, "");
  if (!text) return null;
  if (!/^\d{1,6}([.,]\d{1,2})?$/.test(text)) return Number.NaN;
  return Math.round(Number(text.replace(",", ".")) * 100);
}
