/**
 * Prefilling the online check-in from the reservation (ADR 0016).
 *
 * Source of truth for *who travels* is the reservation's occupancy; the check-in creates
 * exactly that many person slots. Personal data the PMS already knows is copied into the
 * matching slots – only plausible values, only fields the property collects, never a
 * channel relay e-mail. Slots without PMS data stay empty for the guest to fill in.
 * The guest may correct everything; `prefilledFields` keeps the provenance.
 */
import { usableContactEmail } from "../contact/email";
import {
  type PropertyRegistrationConfig,
  type RegistrationField,
  type RegistrationGuest,
  type RegistrationGuestData,
} from "./registration-model";
import { fieldsForRole, normalizeGuestInput } from "./registration-rules";

/** Guest data as a PMS delivers it, already mapped to our field names (unvalidated). */
export type PmsGuestData = Partial<Record<RegistrationField, string>>;

/** Who is booked: from the reservation, never from the guest. */
export type PmsOccupancy = { adults: number; children: number; childrenAges?: readonly number[] };

export type PmsReservationGuests = {
  occupancy?: PmsOccupancy;
  /** Index 0 = primary guest, then further guests in the PMS's order. */
  guests: readonly PmsGuestData[];
};

/** Total travellers of an occupancy (adults + children), undefined if unknown or empty. */
export function occupancyTotal(occupancy: PmsOccupancy | undefined): number | undefined {
  if (!occupancy) return undefined;
  const total = occupancy.adults + occupancy.children;
  return total >= 1 ? total : undefined;
}

/**
 * PMS guests → person slots for positions 0 … guestCount-1. Implausible values are dropped
 * silently (the guest is asked instead); empty slots are omitted.
 */
export function prefillGuests(
  config: PropertyRegistrationConfig,
  pms: PmsReservationGuests,
  guestCount: number,
  today: string,
): RegistrationGuest[] {
  const slots: RegistrationGuest[] = [];
  for (let position = 0; position < guestCount; position++) {
    const source = pms.guests[position];
    if (!source) continue;
    const role = position === 0 ? "primary" : "companion";
    const raw: Record<string, string> = { ...source };
    // A relay e-mail (e.g. …@guest.booking.com) is treated as "no e-mail".
    const email = usableContactEmail(source.email);
    if (email) raw["email"] = email;
    else delete raw["email"];
    // National numbers are read in the guest's own country if the PMS knows it.
    const hint = source.country ?? source.nationality;
    if (hint) raw["phoneCountry"] = hint;
    const { data } = normalizeGuestInput(raw, fieldsForRole(config, role), today);
    const fields = Object.keys(data) as RegistrationField[];
    if (fields.length === 0) continue;
    slots.push({
      position,
      role,
      data: data satisfies RegistrationGuestData,
      prefilledFields: fields,
    });
  }
  return slots;
}
