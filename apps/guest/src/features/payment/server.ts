import "server-only";

import { recordPaymentObservation } from "@up/db";
import { cache } from "react";

import { paymentConfigOf } from "../../config/payment";
import { logger } from "../../server/logger";
import { getDatabase } from "../../server/database";
import { getApaleoPaymentProvider } from "../../server/pms";
import { type GuestContext } from "../guest-context/guest-context";
import { type LoadedPayment, loadPayment, type RecordPayment } from "./load-payment";
import { paymentObservationOf } from "./payment-observation";

/** Records the check in the database (B1) – tenant from the guest context, never input. */
const record: RecordPayment = async (context, evaluation, observedAt) => {
  const db = getDatabase();
  if (!db) return {};
  const stored = await recordPaymentObservation(
    db,
    { tenantId: context.tenantId },
    paymentObservationOf(context, evaluation, observedAt),
  );
  return stored.clearedAt ? { clearedAt: stored.clearedAt.toISOString() } : {};
};

/** Once per request: the reservation's payment state (undefined when payments are off). */
export const getPayment = cache((context: GuestContext): Promise<LoadedPayment | undefined> =>
  loadPayment(
    {
      config: paymentConfigOf(context.property),
      // Only Apaleo reservations have folios; the mock preview has none.
      provider: (guest) =>
        guest.reservationProvider === "apaleo" ? getApaleoPaymentProvider() : undefined,
      record,
      logger,
    },
    context,
  ),
);
