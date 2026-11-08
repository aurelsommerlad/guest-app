/**
 * Recording impressions, views and click-outs reported by the guest's browser (Phase 1).
 * Daily totals only (no reservation, session or IP stored); events for offers that are not
 * shown to this stay are dropped; a per-stay rate limit protects the counters.
 */
import {
  CLIENT_REPORTABLE_EVENTS,
  hashSecret,
  localDateOf,
  type OfferMetricEvent,
  type OfferPlacement,
  OFFER_METRIC_EVENTS,
  OFFER_PLACEMENTS,
} from "@up/core";
import { hitRateLimit, recordOfferMetrics } from "@up/db";

import { type GuestContext } from "../guest-context/guest-context";
import { type StayJourney } from "../journey/stay-journey";
import { loadOfferCatalog, type UpsellDeps } from "./upsell-service";

export const OFFER_EVENTS_RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 300 } as const;
const MAX_EVENTS_PER_CALL = 24;

export type ReportedOfferEvent = { offerId: string; event: string; placement: string };

export async function recordReportedOfferEvents(
  deps: UpsellDeps & { now: () => Date },
  context: GuestContext,
  journey: StayJourney,
  /** Untrusted browser input – validated field by field. */
  events: unknown,
): Promise<number> {
  const list: readonly unknown[] = Array.isArray(events) ? (events as unknown[]) : [];
  if (!deps.db || list.length === 0) return 0;
  // Validated against STAY's own catalog only: counters exist for STAY's offers, and a report
  // must not cost a call to the Extras bridge.
  const catalog = await loadOfferCatalog({ ...deps, extras: undefined }, context, journey, "de");
  if (!catalog) return 0;
  const shown = new Set(catalog.source.map((offer) => offer.id));
  const valid = list.slice(0, MAX_EVENTS_PER_CALL).flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const item = raw as Partial<Record<keyof ReportedOfferEvent, unknown>>;
    const event = item.event as OfferMetricEvent;
    const placement = item.placement as OfferPlacement;
    return typeof item.offerId === "string" &&
      shown.has(item.offerId) &&
      OFFER_METRIC_EVENTS.includes(event) &&
      CLIENT_REPORTABLE_EVENTS.has(event) &&
      OFFER_PLACEMENTS.includes(placement)
      ? [{ offerId: item.offerId, propertyId: context.propertyId, event, placement }]
      : [];
  });
  if (valid.length === 0) return 0;
  // The bucket key is a hash of the stay – the counters themselves carry no reference.
  const subject = hashSecret(
    `${context.tenantId}:${context.reservationProvider}:${context.externalReservationId}`,
  );
  const bucket = await hitRateLimit(
    deps.db,
    `offer-events:${subject}`,
    OFFER_EVENTS_RATE_LIMIT.windowMs,
    deps.now(),
  );
  if (bucket.hits > OFFER_EVENTS_RATE_LIMIT.max) return 0;
  const day = localDateOf(deps.now(), journey.window.timeZone);
  return recordOfferMetrics(deps.db, context, valid, day);
}
