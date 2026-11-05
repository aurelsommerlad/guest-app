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

export type LoadedPayment = {
  config: PaymentConfig;
  evaluation: PaymentEvaluation;
  /** When the guest's amount was first confirmed (write-once, Phase B1); access rules 2/3. */
  clearedAt?: string;
};

/**
 * Persists one evaluation (check instant, state changes, first confirmation). Returns the
 * stored `cleared_at`. Optional: without a database nothing is recorded.
 */
export type RecordPayment = (
  context: GuestContext,
  evaluation: PaymentEvaluation,
  observedAt: Date,
) => Promise<{ clearedAt?: string }>;

/**
 * Payment state of the guest's reservation (Phase 12 A): read live from the provider and
 * evaluated on the server. Off → undefined (no statement at all). Any provider failure →
 * "unknown" (never "paid"), logged without amounts or personal data.
 */
export async function loadPayment(
  deps: {
    config: PaymentConfig;
    provider: (context: GuestContext) => PaymentProvider | undefined;
    record?: RecordPayment;
    /** Real time of the check – never the preview clock. */
    clock?: () => Date;
    logger: Logger;
  },
  context: GuestContext,
): Promise<LoadedPayment | undefined> {
  const { config } = deps;
  if (config.mode === "off") return undefined;
  const provider = deps.provider(context);
  let evaluation: PaymentEvaluation;
  if (!provider) {
    evaluation = unknownPayment();
  } else {
    try {
      const summary = await provider.getPaymentSummary(context.externalReservationId);
      evaluation = evaluatePayment(summary, config, context.now);
    } catch (error) {
      deps.logger.warn("payment data could not be loaded", {
        kind: error instanceof PmsError ? error.kind : "unexpected",
      });
      evaluation = unknownPayment();
    }
  }
  if (!deps.record) return { config, evaluation };
  try {
    const stored = await deps.record(context, evaluation, (deps.clock ?? (() => new Date()))());
    return { config, evaluation, ...(stored.clearedAt ? { clearedAt: stored.clearedAt } : {}) };
  } catch (error) {
    // Recording must never break the page – and never turns a state into "paid".
    deps.logger.error("payment state could not be recorded", {
      error: error instanceof Error ? { name: error.name } : "unknown",
    });
    return { config, evaluation };
  }
}
