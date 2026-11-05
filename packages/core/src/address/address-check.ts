/**
 * Address plausibility (ADR 0021). Three levels – none of them means "verified":
 *
 * - unverified          nothing could be checked, or the address is incomplete / malformed
 * - formally-valid      required parts present, country known, postal code shape fits
 * - postally-plausible  additionally a provider matched it at building level and the stored
 *                       address is exactly what the provider returned (or what the guest picked
 *                       from the suggestions, unchanged)
 *
 * Even "postally-plausible" only says that such an address exists in the provider's data. It
 * never proves that the guest lives there; UI and admin must not word it as a confirmation.
 * Manual entry is always allowed and never blocks the check-in.
 */
import { isCountryCode } from "../registration/countries";
import { checkPostalCode, normalizePostalCode } from "./postal-codes";

export const ADDRESS_STATUSES = ["unverified", "formally-valid", "postally-plausible"] as const;
export type AddressStatus = (typeof ADDRESS_STATUSES)[number];

export type PostalAddress = {
  street: string;
  postalCode?: string;
  city: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
};

export type AddressFieldIssue = {
  field: "street" | "postalCode" | "city" | "country";
  code: "required" | "invalid" | "invalid-format";
};

/** How precisely a provider located an address. Only premise levels count as plausible. */
export const ADDRESS_GRANULARITIES = [
  "sub-premise",
  "premise",
  "route",
  "locality",
  "other",
] as const;
export type AddressGranularity = (typeof ADDRESS_GRANULARITIES)[number];

/**
 * Provider-neutral evidence. Adapters (Google Places / Address Validation, ADR 0021) map their
 * response onto this; raw provider payloads are never stored.
 */
export type AddressEvidence =
  | {
      kind: "provider-validation";
      granularity: AddressGranularity;
      /** Provider considers every component present. */
      complete: boolean;
      /** Provider replaced, inferred or could not confirm a component. */
      corrected: boolean;
      /** The provider's standardised form of the address. */
      standardized: PostalAddress;
    }
  | {
      kind: "autocomplete-selection";
      granularity: AddressGranularity;
      /** The address exactly as the guest picked it from the suggestions. */
      selected: PostalAddress;
    };

export type AddressInputMode = "autocomplete" | "manual";

export type AddressAssessment = {
  status: AddressStatus;
  issues: AddressFieldIssue[];
  /** Why the status is not higher – for the admin and for tests, never shown as proof. */
  reason:
    | "incomplete"
    | "no-evidence"
    | "provider-unavailable"
    | "coarse-match"
    | "provider-corrected"
    | "changed-after-match"
    | "matched";
};

const CONTROL_OR_MARKUP = /[\p{Cc}<>]/u;

function clean(value: string | undefined): string {
  return (value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Structural issues of an address (empty = formally valid). */
export function addressIssues(address: Partial<PostalAddress>): AddressFieldIssue[] {
  const issues: AddressFieldIssue[] = [];
  const street = clean(address.street);
  const city = clean(address.city);
  const country = clean(address.country).toUpperCase();
  if (street === "") issues.push({ field: "street", code: "required" });
  else if (street.length > 200 || CONTROL_OR_MARKUP.test(street))
    issues.push({ field: "street", code: "invalid" });
  if (city === "") issues.push({ field: "city", code: "required" });
  else if (city.length > 100 || CONTROL_OR_MARKUP.test(city))
    issues.push({ field: "city", code: "invalid" });
  if (country === "") {
    issues.push({ field: "country", code: "required" });
    return issues;
  }
  if (!isCountryCode(country)) {
    issues.push({ field: "country", code: "invalid" });
    return issues;
  }
  const postal = checkPostalCode(country, address.postalCode);
  if (postal === "missing") issues.push({ field: "postalCode", code: "required" });
  if (postal === "invalid-format") issues.push({ field: "postalCode", code: "invalid-format" });
  return issues;
}

/** Comparable form: case, whitespace and common street abbreviations do not matter. */
function comparable(address: PostalAddress): string {
  const street = clean(address.street)
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/str\.(?=\s|\d|$)/g, "strasse")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ");
  return [
    street,
    normalizePostalCode(address.postalCode ?? "").replace(/[\s-]/g, ""),
    clean(address.city).toLowerCase(),
    clean(address.country).toUpperCase(),
  ].join("|");
}

export function sameAddress(a: PostalAddress, b: PostalAddress): boolean {
  return comparable(a) === comparable(b);
}

const PREMISE_LEVELS: ReadonlySet<AddressGranularity> = new Set(["premise", "sub-premise"]);

/**
 * Classifies the stored address. `evidence` is whatever a provider said about it (if any);
 * `providerUnavailable` marks a failed lookup (the check-in continues).
 */
export function assessAddress(
  address: Partial<PostalAddress>,
  evidence?: AddressEvidence,
  options: { providerUnavailable?: boolean } = {},
): AddressAssessment {
  const issues = addressIssues(address);
  if (issues.length > 0) return { status: "unverified", issues, reason: "incomplete" };
  const current = address as PostalAddress;
  const formal = (reason: AddressAssessment["reason"]): AddressAssessment => ({
    status: "formally-valid",
    issues: [],
    reason,
  });
  if (!evidence)
    return formal(options.providerUnavailable ? "provider-unavailable" : "no-evidence");
  if (!PREMISE_LEVELS.has(evidence.granularity)) return formal("coarse-match");
  if (evidence.kind === "provider-validation") {
    if (!evidence.complete || evidence.corrected) return formal("provider-corrected");
    if (!sameAddress(current, evidence.standardized)) return formal("changed-after-match");
  } else if (!sameAddress(current, evidence.selected)) {
    return formal("changed-after-match");
  }
  return { status: "postally-plausible", issues: [], reason: "matched" };
}
