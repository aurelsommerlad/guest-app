import {
  evaluatePayment,
  type Logger,
  type PaymentConfig,
  type PaymentEvaluation,
  type PaymentProvider,
  PmsError,
  unknownPayment,
} from "@up/core";

import { type GuestContext } from "../guest-context/guest-context";

export type LoadedPayment = { config: PaymentConfig; evaluation: PaymentEvaluation };

/**
 * Payment state of the guest's reservation (Phase 12 A): read live from the provider and
 * evaluated on the server. Off → undefined (no statement at all). Any provider failure →
 * "unknown" (never "paid"), logged without amounts or personal data.
 */
export async function loadPayment(
  deps: {
    config: PaymentConfig;
    provider: (context: GuestContext) => PaymentProvider | undefined;
    logger: Logger;
  },
  context: GuestContext,
): Promise<LoadedPayment | undefined> {
  const { config } = deps;
  if (config.mode === "off") return undefined;
  const provider = deps.provider(context);
  if (!provider) return { config, evaluation: unknownPayment() };
  try {
    const summary = await provider.getPaymentSummary(context.externalReservationId);
    return { config, evaluation: evaluatePayment(summary, config, context.now) };
  } catch (error) {
    deps.logger.warn("payment data could not be loaded", {
      kind: error instanceof PmsError ? error.kind : "unexpected",
    });
    return { config, evaluation: unknownPayment() };
  }
}
