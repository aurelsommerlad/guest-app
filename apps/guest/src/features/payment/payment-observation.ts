import { confirmsPayment, type PaymentEvaluation } from "@up/core";
import { type PaymentObservation } from "@up/db";

import { type GuestContext } from "../guest-context/guest-context";

/**
 * What is recorded for one evaluation (Phase 12 B1): the state and the check instant, and –
 * only when the provider confirmed settlement – the paid amount and the confirming payment
 * ids. Pure. Unknown / pending / review never count as confirmed.
 */
export function paymentObservationOf(
  context: GuestContext,
  evaluation: PaymentEvaluation,
  observedAt: Date,
): PaymentObservation {
  const confirmed =
    confirmsPayment(evaluation) && evaluation.totals && evaluation.currency
      ? {
          amountMinor: Math.round(evaluation.totals.paid * 100),
          currency: evaluation.currency,
          providerPaymentIds: evaluation.folios.flatMap((folio) =>
            folio.payments
              .filter((payment) => payment.status === "success")
              .map((payment) => payment.id),
          ),
        }
      : undefined;
  return {
    propertyId: context.propertyId,
    reservationProvider: context.reservationProvider,
    externalReservationId: context.externalReservationId,
    state: evaluation.state,
    observedAt,
    ...(confirmed ? { confirmed } : {}),
  };
}
