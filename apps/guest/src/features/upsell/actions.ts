"use server";

import { getGuestContext } from "../guest-context/server";
import { getStayJourney } from "../journey/server";
import { type ReportedOfferEvent, recordReportedOfferEvents } from "./metrics-service";
import { upsellDeps } from "./server";

/**
 * Impressions, detail views and click-outs from the guest's browser – fire and forget. The
 * stay comes from the server-side session; the browser only names offer ids it was shown.
 */
export async function reportOfferEvents(events: ReportedOfferEvent[]): Promise<void> {
  const result = await getGuestContext();
  if (result.kind !== "context") return;
  const journey = await getStayJourney(result.context);
  if (!journey) return;
  await recordReportedOfferEvents(
    { ...upsellDeps(), now: () => new Date() },
    result.context,
    journey,
    events,
  );
}
