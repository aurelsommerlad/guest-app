"use server";

import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { getGuestContext } from "../guest-context/server";
import { getStayJourney } from "../journey/server";
import { bookExtra, type BookingOutcome, extendStay, requestExtra } from "./booking-service";
import { getExtrasBridge } from "./server";

/**
 * Server actions of the booking flow. The stay comes from the guest session only; the input is
 * validated in the booking service; Extras re-checks price and availability before booking.
 */
async function run(action: typeof bookExtra, input: unknown): Promise<BookingOutcome> {
  const result = await getGuestContext();
  if (result.kind !== "context") return { kind: "error", reason: "unavailable" };
  const journey = await getStayJourney(result.context);
  return action(
    {
      db: getDatabase(),
      logger,
      extras: getExtrasBridge(),
      now: () => new Date(),
      timeZone: journey?.window.timeZone ?? result.context.property.timeZone,
    },
    result.context,
    input,
  );
}

export async function bookExtraAction(input: unknown): Promise<BookingOutcome> {
  return run(bookExtra, input);
}

export async function requestExtraAction(input: unknown): Promise<BookingOutcome> {
  return run(requestExtra, input);
}

export async function extendStayAction(input: unknown): Promise<BookingOutcome> {
  return run(extendStay, input);
}
