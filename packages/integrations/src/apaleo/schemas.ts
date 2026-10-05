import { z } from "zod";

/**
 * Validation of Apaleo responses. Only the fields we use are declared – everything
 * else (e-mail, phone, address, payment data …) is stripped on parse and never
 * leaves this module (data minimisation).
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
