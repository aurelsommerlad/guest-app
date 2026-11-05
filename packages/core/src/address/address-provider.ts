/**
 * Port for address suggestions and validation (ADR 0021; adapter: Google Places API (New) and
 * Address Validation API, server-side only – the key never reaches the browser).
 *
 * Only address fragments are sent – never names, booking data or contact details. Search
 * input is not stored. Implementations must not throw for expected failures; they return
 * `{ ok: false }` and the guest continues with manual entry.
 */
import { type AddressEvidence, type AddressGranularity, type PostalAddress } from "./address-check";

export type AddressSuggestion = {
  /** Provider reference for the details lookup (opaque, short-lived). */
  ref: string;
  /** One-line label as shown in the list. */
  label: string;
};

export type AddressLookupFailure = {
  ok: false;
  reason: "unavailable" | "rate-limited" | "not-configured" | "unsupported-country";
};

export interface AddressProvider {
  /** Suggestions while typing; sessionToken groups one search for billing. */
  suggest(input: {
    query: string;
    sessionToken: string;
    country?: string;
    locale: string;
  }): Promise<{ ok: true; suggestions: AddressSuggestion[] } | AddressLookupFailure>;
  /** Structured address of a picked suggestion (ends the billing session). */
  details(input: {
    ref: string;
    sessionToken: string;
    locale: string;
  }): Promise<
    { ok: true; address: PostalAddress; granularity: AddressGranularity } | AddressLookupFailure
  >;
  /** Plausibility check of a complete address (manual entry or after a pick). */
  validate(
    address: PostalAddress,
  ): Promise<
    | { ok: true; evidence: Extract<AddressEvidence, { kind: "provider-validation" }> }
    | AddressLookupFailure
  >;
}
