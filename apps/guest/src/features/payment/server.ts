import "server-only";

import { cache } from "react";

import { paymentConfigOf } from "../../config/payment";
import { logger } from "../../server/logger";
import { getApaleoPaymentProvider } from "../../server/pms";
import { type GuestContext } from "../guest-context/guest-context";
import { type LoadedPayment, loadPayment } from "./load-payment";

/** Once per request: the reservation's payment state (undefined when payments are off). */
export const getPayment = cache((context: GuestContext): Promise<LoadedPayment | undefined> =>
  loadPayment(
    {
      config: paymentConfigOf(context.property),
      // Only Apaleo reservations have folios; the mock preview has none.
      provider: (guest) =>
        guest.reservationProvider === "apaleo" ? getApaleoPaymentProvider() : undefined,
      logger,
    },
    context,
  ),
);
