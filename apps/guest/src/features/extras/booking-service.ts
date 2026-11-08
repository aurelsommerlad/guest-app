/**
 * Booking, requesting and extending through the Extras bridge (upselling Phase 2,
 * framework-free). The stay always comes from the server-side guest context; the browser only
 * names the service, the quantity, licence plates, the price it showed and an idempotency key.
 * Extras re-checks availability and price and alone books into Apaleo.
 */
import { hashSecret, localDateOf, type Logger } from "@up/core";
import { type Database, hitRateLimit, listPropertyOffers, recordOfferMetrics } from "@up/db";
import { z } from "zod";

import { extrasBridgeEnabled } from "../../config/upsell";
import { type GuestContext } from "../guest-context/guest-context";
import { bridgeSubject } from "../upsell/upsell-service";
import { type BridgeResult, type ExtrasBridge, type ExtrasRefusal } from "./bridge-client";

export type BookingDeps = {
  db: Database | undefined;
  logger: Logger;
  extras: ExtrasBridge | undefined;
  now: () => Date;
  timeZone: string;
};

export type BookingOutcome =
  | { kind: "booked"; serviceDates: string[]; amountCents?: number; currency?: string }
  | { kind: "requested" }
  | { kind: "extended"; newDeparture: string }
  | {
      kind: "error";
      reason: ExtrasRefusal | "unavailable" | "invalid";
      price?: { amountCents: number; currency: string };
    };

/** STAY's own brake in front of the bridge (which has its own limits as well). */
export const BOOKING_RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 30 } as const;

const uuid = z.uuid();
const money = z.object({
  amountCents: z.number().int().min(0).max(10_000_000),
  currency: z.string().length(3),
});
const orderSchema = z.object({
  idempotencyKey: uuid,
  serviceId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
  count: z.number().int().min(1).max(20),
  vehiclePlates: z.array(z.string().trim().min(1).max(20)).max(20).optional(),
  expectedPrice: money,
});
const requestSchema = z.object({
  idempotencyKey: uuid,
  serviceId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
  quantity: z.number().int().min(1).max(20),
});
const extensionSchema = z.object({
  idempotencyKey: uuid,
  currentDeparture: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedPrice: money,
});

async function guard(deps: BookingDeps, context: GuestContext) {
  const subject = bridgeSubject(context);
  if (!deps.extras || !deps.db || !subject || !extrasBridgeEnabled(context.property))
    return undefined;
  const key = hashSecret(
    `${context.tenantId}:${context.reservationProvider}:${context.externalReservationId}`,
  );
  const bucket = await hitRateLimit(
    deps.db,
    `extras-booking:${key}`,
    BOOKING_RATE_LIMIT.windowMs,
    deps.now(),
  );
  if (bucket.hits > BOOKING_RATE_LIMIT.max) return "limited" as const;
  return { bridge: deps.extras, subject };
}

function failure<T>(result: Exclude<BridgeResult<T>, { kind: "ok" }>): BookingOutcome {
  return result.kind === "refused"
    ? { kind: "error", reason: result.reason, ...(result.price ? { price: result.price } : {}) }
    : { kind: "error", reason: "unavailable" };
}

/** Attributable revenue for "Services & Erlebnisse" – daily totals only, no reference to the stay. */
async function recordBooking(
  deps: BookingDeps,
  context: GuestContext,
  serviceId: string,
  revenueCents: number,
): Promise<void> {
  if (!deps.db) return;
  try {
    const offers = await listPropertyOffers(deps.db, context, context.propertyId);
    const offer = offers.find((item) => item.extrasServiceId === serviceId);
    if (!offer) return;
    await recordOfferMetrics(
      deps.db,
      context,
      [
        {
          offerId: offer.id,
          propertyId: context.propertyId,
          placement: "detail",
          event: "booking",
          revenueCents,
        },
      ],
      localDateOf(deps.now(), deps.timeZone),
    );
  } catch (error) {
    deps.logger.warn("booking metric not recorded", {
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}

export async function bookExtra(
  deps: BookingDeps,
  context: GuestContext,
  raw: unknown,
): Promise<BookingOutcome> {
  const input = orderSchema.safeParse(raw);
  if (!input.success) return { kind: "error", reason: "invalid" };
  const connection = await guard(deps, context);
  if (connection === "limited") return { kind: "error", reason: "rate_limited" };
  if (!connection) return { kind: "error", reason: "unavailable" };
  const result = await connection.bridge.order(connection.subject, input.data);
  deps.logger.info("extras order", {
    serviceId: input.data.serviceId,
    outcome: result.kind === "refused" ? result.reason : result.kind,
  });
  if (result.kind !== "ok") return failure(result);
  await recordBooking(deps, context, input.data.serviceId, result.value.price?.amountCents ?? 0);
  return {
    kind: "booked",
    serviceDates: result.value.serviceDates,
    ...(result.value.price
      ? { amountCents: result.value.price.amountCents, currency: result.value.price.currency }
      : {}),
  };
}

export async function requestExtra(
  deps: BookingDeps,
  context: GuestContext,
  raw: unknown,
): Promise<BookingOutcome> {
  const input = requestSchema.safeParse(raw);
  if (!input.success) return { kind: "error", reason: "invalid" };
  const connection = await guard(deps, context);
  if (connection === "limited") return { kind: "error", reason: "rate_limited" };
  if (!connection) return { kind: "error", reason: "unavailable" };
  const result = await connection.bridge.request(connection.subject, input.data);
  deps.logger.info("extras request", {
    serviceId: input.data.serviceId,
    outcome: result.kind === "refused" ? result.reason : result.kind,
  });
  return result.kind === "ok" ? { kind: "requested" } : failure(result);
}

export async function extendStay(
  deps: BookingDeps,
  context: GuestContext,
  raw: unknown,
): Promise<BookingOutcome> {
  const input = extensionSchema.safeParse(raw);
  if (!input.success) return { kind: "error", reason: "invalid" };
  const connection = await guard(deps, context);
  if (connection === "limited") return { kind: "error", reason: "rate_limited" };
  if (!connection) return { kind: "error", reason: "unavailable" };
  const result = await connection.bridge.extend(connection.subject, input.data);
  deps.logger.info("extras extension", {
    outcome: result.kind === "refused" ? result.reason : result.kind,
  });
  return result.kind === "ok"
    ? { kind: "extended", newDeparture: result.value.newDeparture }
    : failure(result);
}
