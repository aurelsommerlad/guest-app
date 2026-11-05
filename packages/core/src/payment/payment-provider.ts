import { type PaymentSummary } from "./payment-summary";

/**
 * Read-only payment port (Phase 12 A). Loads the payment data of one reservation from the
 * provider. Rejects with a `PmsError` (kinds auth / not-found / timeout / unavailable /
 * invalid-response); callers treat every failure as "unknown" – never as "paid".
 * Creating payment links follows in Phase B (separate approval).
 */
export interface PaymentProvider {
  readonly name: string;
  getPaymentSummary(reservationId: string): Promise<PaymentSummary>;
}
