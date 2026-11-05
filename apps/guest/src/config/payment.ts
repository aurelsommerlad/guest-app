import { type PaymentConfig, paymentConfigSchema, PAYMENTS_OFF } from "@up/core";

import { type RegisteredProperty } from "./properties";

/**
 * Payment settings of a property (Phase 12 A). Only test properties – which never resolve in
 * production – can switch payments on; every real property is "off" until the settings live
 * in the Admin (C5) and are approved. "enforce" is not honoured before Phase C: at most
 * "inform" (overview and notices, never a lock).
 */
export function paymentConfigOf(
  property: Pick<RegisteredProperty, "testOnly" | "payment">,
): PaymentConfig {
  if (!property.testOnly || !property.payment) return PAYMENTS_OFF;
  const parsed = paymentConfigSchema.safeParse(property.payment);
  if (!parsed.success) return PAYMENTS_OFF;
  return parsed.data.mode === "enforce" ? { ...parsed.data, mode: "inform" } : parsed.data;
}
