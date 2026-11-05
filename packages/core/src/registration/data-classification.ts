/**
 * Legal registration data vs. operational contact data (ADR 0021).
 *
 * - legal: what registration law (Meldeschein / Gästeblatt) may require; kept for the legal
 *   retention period of the property's country.
 * - contact: what UNIQUE PLACES needs to run the stay (reach the guest, send codes); its own
 *   purpose and a shorter retention. Persisted separately from C2 on.
 */
import {
  REGISTRATION_FIELDS,
  type RegistrationField,
  type RegistrationGuestData,
} from "./registration-model";

export const DATA_CLASSES = ["legal", "contact"] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export const FIELD_DATA_CLASS: Readonly<Record<RegistrationField, DataClass>> = {
  firstName: "legal",
  lastName: "legal",
  birthDate: "legal",
  nationality: "legal",
  street: "legal",
  postalCode: "legal",
  city: "legal",
  country: "legal",
  documentType: "legal",
  documentNumber: "legal",
  email: "contact",
  phone: "contact",
};

export const LEGAL_FIELDS = REGISTRATION_FIELDS.filter((f) => FIELD_DATA_CLASS[f] === "legal");
export const CONTACT_FIELDS = REGISTRATION_FIELDS.filter((f) => FIELD_DATA_CLASS[f] === "contact");

/**
 * Splits one traveller's data. Names appear in both: the contact record needs to know whom it
 * reaches, but is stored with its own retention.
 */
export function splitGuestData(data: RegistrationGuestData): {
  legal: RegistrationGuestData;
  contact: RegistrationGuestData;
} {
  const legal: RegistrationGuestData = {};
  const contact: RegistrationGuestData = {};
  for (const field of REGISTRATION_FIELDS) {
    const value = data[field];
    if (value === undefined) continue;
    if (FIELD_DATA_CLASS[field] === "legal") legal[field] = value;
    else contact[field] = value;
  }
  if (data.firstName !== undefined) contact.firstName = data.firstName;
  if (data.lastName !== undefined) contact.lastName = data.lastName;
  return { legal, contact };
}
