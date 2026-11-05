/**
 * "Same address as the main guest" for fellow travellers (ADR 0021). Stored as a reference,
 * not a copy: when the main guest corrects the address, it is correct for everyone. Resolved
 * when the registration is submitted / exported.
 */
import { type RegistrationGuest, type RegistrationGuestData } from "./registration-model";

export const SHARED_ADDRESS_POLICIES = ["allowed", "never"] as const;
export type SharedAddressPolicy = (typeof SHARED_ADDRESS_POLICIES)[number];

export type AddressSource = "own" | "same-as-primary";

const ADDRESS_PARTS = ["street", "postalCode", "city", "country"] as const;

export type SharedAddressGuest = RegistrationGuest & { addressSource?: AddressSource };

export type SharedAddressResult =
  | { ok: true; guests: RegistrationGuest[] }
  | { ok: false; error: "not-allowed" | "primary-missing"; position: number };

/** Copies the main guest's address into travellers that reference it. */
export function resolveSharedAddresses(
  guests: readonly SharedAddressGuest[],
  policy: SharedAddressPolicy,
): SharedAddressResult {
  const primary = guests.find((guest) => guest.position === 0);
  const resolved: RegistrationGuest[] = [];
  for (const guest of guests) {
    const { addressSource, ...rest } = guest;
    if (addressSource !== "same-as-primary" || guest.position === 0) {
      resolved.push(rest);
      continue;
    }
    if (policy === "never") return { ok: false, error: "not-allowed", position: guest.position };
    if (
      !primary ||
      ADDRESS_PARTS.some((part) => primary.data[part] === undefined && part !== "postalCode")
    ) {
      return { ok: false, error: "primary-missing", position: guest.position };
    }
    const data: RegistrationGuestData = Object.fromEntries(
      Object.entries(rest.data).filter(
        ([field]) => !(ADDRESS_PARTS as readonly string[]).includes(field),
      ),
    );
    for (const part of ADDRESS_PARTS) {
      const value = primary.data[part];
      if (value !== undefined) data[part] = value;
    }
    resolved.push({ ...rest, data });
  }
  return { ok: true, guests: resolved };
}
