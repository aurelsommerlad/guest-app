import { z } from "zod";

/**
 * When the guest's open amount becomes due (Apaleo has no "payment due" field):
 * - at-free-cancellation-end: when free cancellation ends (no free cancellation: at booking)
 * - days-before-arrival: n days before the arrival instant
 * - at-booking: as soon as it is booked
 */
export const paymentDueRuleSchema = z.discriminatedUnion("rule", [
  z.object({ rule: z.literal("at-free-cancellation-end") }),
  z.object({ rule: z.literal("days-before-arrival"), days: z.number().int().min(0).max(365) }),
  z.object({ rule: z.literal("at-booking") }),
]);
export type PaymentDueRule = z.infer<typeof paymentDueRuleSchema>;

/**
 * Payment settings of a property (later per tenant/property in the Admin, ADR 0018).
 * - mode: off (nothing), inform (overview and notices only), enforce (access gating – Phase C)
 * - due: default rule; ratePlans: overrides per rate plan id
 * - otaWithoutSignal: what an OTA channel without a clear "collected by OTA" signal means
 * Business rule (2026-11-05): once due, the WHOLE open amount is due, not only the fee.
 */
export const paymentConfigSchema = z.object({
  mode: z.enum(["off", "inform", "enforce"]),
  due: paymentDueRuleSchema,
  ratePlans: z.record(z.string().min(1), paymentDueRuleSchema).optional(),
  otaWithoutSignal: z.enum(["review", "not-applicable"]).default("review"),
});
export type PaymentConfig = z.infer<typeof paymentConfigSchema>;

export const PAYMENTS_OFF: PaymentConfig = {
  mode: "off",
  due: { rule: "at-free-cancellation-end" },
  otaWithoutSignal: "review",
};
