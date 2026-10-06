import { z } from "zod";

/**
 * Validation of Apaleo responses. Only the fields we use are declared – everything
 * else (payment data, company, preferences …) is stripped on parse and never leaves
 * this module (data minimisation). Guest contact data is read only for the check-in
 * prefill and the write-back merge.
 */

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  token_type: z.string(),
});

export type TokenResponse = z.infer<typeof tokenResponseSchema>;

/** Apaleo reservation status values (Booking API ReservationModel.status). */
export const apaleoReservationStatusSchema = z.enum([
  "Confirmed",
  "InHouse",
  "CheckedOut",
  "Canceled",
  "NoShow",
]);

/** Date and time with UTC offset (ISO 8601), as Apaleo returns arrival/departure. */
const isoDateTimeWithOffset = z.iso.datetime({ offset: true });

export const apaleoReservationSchema = z.object({
  id: z.string().min(1),
  status: apaleoReservationStatusSchema,
  arrival: isoDateTimeWithOffset,
  departure: isoDateTimeWithOffset,
  property: z.object({ id: z.string().min(1) }),
  /** Missing while no unit is assigned. */
  unit: z.object({ id: z.string().min(1) }).optional(),
  primaryGuest: z
    .object({
      firstName: z.string().optional(),
    })
    .optional(),
  /** ReservationModel.adults (required) and childrenAges – size the online check-in. */
  adults: z.number().int().min(0).max(99).optional(),
  childrenAges: z.array(z.number().int().min(0).max(30)).max(99).optional(),
});

export type ApaleoReservation = z.infer<typeof apaleoReservationSchema>;

/**
 * Same reservation plus the primary guest's last name – used only for the guest login
 * knowledge check. `lastName` is required in Apaleo's guest model; we still treat it as
 * optional and fail closed when it is missing.
 */
export const apaleoReservationForLoginSchema = apaleoReservationSchema.extend({
  primaryGuest: z
    .object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
    })
    .optional(),
});

/**
 * Guest model fields of the Booking API (GuestModel / PersonAddressModel) that the
 * registration write-back manages. Verified against the official apaleo-maintained client
 * @apaleo/angular-api-proxy-booking 19.0.29 (generated from the Booking API spec): the
 * PATCH operation allows "Replace PrimaryGuest" and "Add, replace and remove
 * AdditionalGuests", scope reservations.manage. Unknown/unmanaged guest fields are kept as
 * they are (loose objects) and written back unchanged.
 */
const apaleoAddressSchema = z.looseObject({
  addressLine1: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  countryCode: z.string().optional(),
});

export const apaleoGuestSchema = z.looseObject({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  birthDate: z.string().optional(),
  nationalityCountryCode: z.string().optional(),
  identificationNumber: z.string().optional(),
  identificationType: z.string().optional(),
  address: apaleoAddressSchema.optional(),
});

export type ApaleoGuest = z.infer<typeof apaleoGuestSchema>;

/** The reservation as the write-back needs it: status plus full guest objects (in memory only). */
export const apaleoReservationGuestsSchema = z.object({
  id: z.string().min(1),
  status: apaleoReservationStatusSchema,
  primaryGuest: apaleoGuestSchema.optional(),
  additionalGuests: z.array(apaleoGuestSchema).optional(),
});

/**
 * Prefill read for the online check-in: occupancy plus the guest fields we may prefill
 * (verified GuestModel fields). Plain objects – everything else (company, preferences,
 * vehicle, booker, payment …) is stripped on parse. Used in memory only, never logged.
 */
const apaleoPrefillGuestSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  birthDate: z.string().optional(),
  nationalityCountryCode: z.string().optional(),
  identificationNumber: z.string().optional(),
  identificationType: z.string().optional(),
  address: z
    .object({
      addressLine1: z.string().optional(),
      postalCode: z.string().optional(),
      city: z.string().optional(),
      countryCode: z.string().optional(),
    })
    .optional(),
});

export type ApaleoPrefillGuest = z.infer<typeof apaleoPrefillGuestSchema>;

export const apaleoReservationPrefillSchema = z.object({
  id: z.string().min(1),
  adults: z.number().int().min(0).max(99),
  childrenAges: z.array(z.number().int().min(0).max(30)).max(99).optional(),
  primaryGuest: apaleoPrefillGuestSchema.optional(),
  additionalGuests: z.array(apaleoPrefillGuestSchema).max(99).optional(),
});
