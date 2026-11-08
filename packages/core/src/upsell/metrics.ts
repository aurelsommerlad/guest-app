/**
 * Measuring success (Phase 1 foundation): counted per offer, property, day and placement –
 * never per guest. No reservation id, no session id, no IP: daily totals only, so no
 * personal profiles can arise (privacy by design).
 */
import { commissionCents, type CommissionModel } from "./offer-model";

export const OFFER_METRIC_EVENTS = [
  /** The offer was visible on a surface. */
  "impression",
  /** The detail page was opened. */
  "view",
  /** The guest followed a partner booking link. */
  "click-out",
  /** A request was sent (house service "auf Anfrage" or partner offer). */
  "request",
  /** A booking was confirmed (instant booking, accepted request, partner report). */
  "booking",
] as const;
export type OfferMetricEvent = (typeof OFFER_METRIC_EVENTS)[number];

/** Where the guest saw / came from (attribution is per placement, not per person). */
export const OFFER_PLACEMENTS = ["home", "services", "detail", "booked"] as const;
export type OfferPlacement = (typeof OFFER_PLACEMENTS)[number];

/** Events the guest's browser may report; requests and bookings are recorded by the server. */
export const CLIENT_REPORTABLE_EVENTS: ReadonlySet<OfferMetricEvent> = new Set([
  "impression",
  "view",
  "click-out",
]);

export type OfferMetricIncrement = {
  offerId: string;
  propertyId: string;
  placement: OfferPlacement;
  event: OfferMetricEvent;
  /** Bookings only: attributed revenue in cents. */
  revenueCents?: number;
  /** Bookings only: commission model that applies (to store the commission with the day). */
  commission?: CommissionModel;
};

export type OfferMetricCounters = {
  impressions: number;
  views: number;
  clickOuts: number;
  requests: number;
  bookings: number;
  revenueCents: number;
  commissionCents: number;
};

const FIELD: Record<OfferMetricEvent, keyof OfferMetricCounters> = {
  impression: "impressions",
  view: "views",
  "click-out": "clickOuts",
  request: "requests",
  booking: "bookings",
};

/** The counter deltas of one event (validated: revenue only with bookings, integer cents). */
export function metricDelta(increment: OfferMetricIncrement): OfferMetricCounters {
  const delta: OfferMetricCounters = {
    impressions: 0,
    views: 0,
    clickOuts: 0,
    requests: 0,
    bookings: 0,
    revenueCents: 0,
    commissionCents: 0,
  };
  delta[FIELD[increment.event]] = 1;
  if (increment.event === "booking") {
    const revenue = increment.revenueCents ?? 0;
    if (!Number.isInteger(revenue) || revenue < 0 || revenue > 100_000_000) {
      throw new RangeError("revenue");
    }
    delta.revenueCents = revenue;
    delta.commissionCents = increment.commission
      ? commissionCents(increment.commission, revenue)
      : 0;
  } else if (increment.revenueCents !== undefined) {
    throw new RangeError("revenue only with bookings");
  }
  return delta;
}

/** Ratios for reports (undefined where the base is zero). */
export function metricRates(counters: OfferMetricCounters) {
  const ratio = (a: number, b: number) => (b > 0 ? a / b : undefined);
  return {
    viewRate: ratio(counters.views, counters.impressions),
    requestRate: ratio(counters.requests, counters.views),
    bookingRate: ratio(counters.bookings, counters.views),
    revenuePerView: ratio(counters.revenueCents, counters.views),
  };
}
