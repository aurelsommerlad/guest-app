import { constantTimeEquals } from "./access-token";

/**
 * Booking number + last name login (ADR 0011): input normalisation and the
 * knowledge check. Deliberately strict – no similarity matching.
 */

const BOOKING_REFERENCE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,39}$/;

/**
 * Trims, removes inner whitespace and uppercases (Apaleo ids are uppercase, e.g.
 * "ABCDEFGH-1"). Returns undefined for anything that cannot be a booking reference,
 * so it never reaches the PMS (e.g. "/", "?", oversized input).
 */
export function normalizeBookingReference(input: string): string | undefined {
  const value = input.replace(/\s+/g, "").toUpperCase();
  return BOOKING_REFERENCE_PATTERN.test(value) ? value : undefined;
}

/**
 * Defined normalisation for last names:
 * Unicode NFC, trimmed, inner whitespace collapsed to one space, lower case.
 * Nothing else: "Müller" ≠ "Mueller", "Muller" ≠ "Müller".
 */
export function normalizeLastName(input: string): string {
  return input.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase().normalize("NFC");
}

/** Compares in constant time. An empty input or unknown PMS name never matches. */
export function lastNameMatches(input: string, pmsLastName: string | undefined): boolean {
  const entered = normalizeLastName(input);
  if (!entered || !pmsLastName) return false;
  const expected = normalizeLastName(pmsLastName);
  if (!expected) return false;
  return constantTimeEquals(entered, expected);
}
