/**
 * Contact e-mail rules (ADR 0016). Some booking channels hand the PMS a *relay* address
 * instead of the guest's own (Booking.com: …@guest.booking.com). Such an address is not a
 * direct contact: it is never prefilled, never accepted as the guest's e-mail and never
 * stored in the check-in state.
 *
 * Only domains positively known as relays are listed – other OTA addresses stay usable.
 * Add further relay domains here (one place, tested).
 */
export const RELAY_EMAIL_DOMAINS: readonly string[] = ["guest.booking.com"];

const EMAIL_PATTERN =
  /^[^\s@<>()[\]\\,;:"]+@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)$/;

/** Trimmed, lowercased address if it is syntactically plausible; undefined otherwise. */
export function normalizeEmail(value: string): string | undefined {
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return undefined;
  return EMAIL_PATTERN.test(email) ? email : undefined;
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

/** True for addresses of a known relay domain (or one of its subdomains). */
export function isRelayEmail(
  value: string,
  relayDomains: readonly string[] = RELAY_EMAIL_DOMAINS,
): boolean {
  const domain = domainOf(value.trim());
  return relayDomains.some((relay) => domain === relay || domain.endsWith(`.${relay}`));
}

/** The address if it can be used to reach the guest directly; undefined for relays/garbage. */
export function usableContactEmail(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const email = normalizeEmail(value);
  return email && !isRelayEmail(email) ? email : undefined;
}
