/**
 * The STAY booking engine behind the guest app's `ExtrasBridge` interface (M4).
 *
 * Same contract as the Extras bridge (lib/stayBridge/service.js), so the existing guest
 * components – catalog, detail page, booking form, request, extension night, "Gebucht &
 * angefragt" – work unchanged:
 *   - catalog: STAY engine catalog + extension offer, prices in cents;
 *   - order: binding total price check, "already booked", then the engine (gateway, simulated);
 *   - request: the engine's request with quantity/availability checks when it is made;
 *   - extend: binding total price check, then the engine's confirmation;
 *   - overview: Apaleo services (any source) + STAY requests, additional guests, extensions.
 * Only ever used for properties the feature switch allows (TEST); see config/upsell.ts.
 */
import { type Database, getServiceBookingByKey, loadReservationServiceRecords } from "@up/db";
import {
  type GuestCatalogItem,
  type ServiceBookingEngine,
  type StayExtensionOffer,
} from "@up/integrations";

import {
  type BridgeResult,
  type BridgeSubject,
  type ExtensionInput,
  type ExtrasBridge,
  type ExtrasCatalog,
  type ExtrasExtension,
  type ExtrasItem,
  type ExtrasOverview,
  type ExtrasRefusal,
  type OrderInput,
  type RequestInput,
} from "./bridge-client";

type Money = { amount: number; currency: string } | null | undefined;
const toCents = (money: Money) =>
  money && Number.isFinite(money.amount)
    ? { amountCents: Math.round(money.amount * 100), currency: money.currency }
    : null;

export type EngineBridgeDeps = {
  db: Database;
  /** Engine for a subject, or undefined if the subject is not allowed (feature switch). */
  engineFor: (
    subject: BridgeSubject,
  ) => Promise<{ engine: ServiceBookingEngine; propertyId: string } | undefined>;
};

function item(entry: GuestCatalogItem, bookedCount: number): ExtrasItem {
  return {
    serviceId: entry.serviceId,
    code: null,
    name: entry.displayName,
    description: entry.description,
    imageUrl: entry.imageUrl,
    actionType: entry.actionType,
    bookingRule: entry.bookingRule,
    fulfillment: entry.fulfillmentMode,
    priceUnitLabel: entry.priceUnitLabel,
    unitPrice: toCents(entry.unitPrice),
    nights: entry.nights,
    price: toCents(entry.price),
    serviceDates: entry.serviceDates ?? [],
    restricted: entry.unitGroupRestricted,
    maxQuantity: entry.maxQuantity,
    maxOnePerReservation: entry.maxOnePerReservation,
    bookedCount,
    requiresVehicleRegistration: entry.requiresVehicleRegistration,
    existingVehicleRegistration: entry.existingVehicleRegistration,
  };
}

function extension(offer: StayExtensionOffer | null): ExtrasExtension | null {
  if (!offer) return null;
  return {
    currentDeparture: offer.currentDeparture,
    newDeparture: offer.newDeparture,
    phase: offer.phase,
    discountPercent: offer.discountPercent,
    extensionPrice: toCents(offer.extensionPrice),
    extras: offer.extras.map((extra) => ({
      serviceId: extra.serviceId,
      name: extra.name,
      amountCents: toCents(extra.amount)?.amountCents ?? null,
    })),
    cityTaxCents: toCents(offer.cityTax)?.amountCents ?? null,
    totalPrice: toCents(offer.totalPrice),
  };
}

const ORDER_REFUSALS: Record<string, ExtrasRefusal> = {
  not_available: "not_available",
  unit_group_restricted: "not_available",
  dog_limit_exceeded: "limit_reached",
  capacity_exceeded: "capacity_exceeded",
  vehicle_registration_required: "vehicle_registration_required",
  price_changed: "price_changed",
  in_progress: "in_progress",
  already_booked: "already_booked",
  already_requested: "already_requested",
  insufficient_availability: "not_available",
  stay_extension_unavailable: "not_available",
};

const refused = <T>(
  reason: string,
  price?: { amountCents: number; currency: string } | null,
): BridgeResult<T> => {
  const mapped = ORDER_REFUSALS[reason];
  return mapped
    ? { kind: "refused", reason: mapped, ...(price ? { price } : {}) }
    : { kind: "unavailable" };
};

const same = (
  a: { amountCents: number; currency: string } | null,
  b: OrderInput["expectedPrice"],
) => a !== null && a.amountCents === b.amountCents && a.currency === b.currency;

type Setup = {
  engine: ServiceBookingEngine;
  context: { tenantId: string; propertyId: string; apaleoPropertyId: string };
};

async function placeOrder(
  db: Database,
  s: Setup,
  subject: BridgeSubject,
  input: OrderInput,
): ReturnType<ExtrasBridge["order"]> {
  // A repeated submit (double click, retry) is answered by the engine from the stored order.
  const previous = await getServiceBookingByKey(db, s.context, input.idempotencyKey);
  const reservation = await s.engine.readReservation(subject.reservationId);
  if (!reservation || reservation.property.id !== subject.apaleoPropertyId)
    return { kind: "unavailable" };
  const catalog = await s.engine.getGuestCatalog(s.context, reservation);
  const entry = catalog.items.find((candidate) => candidate.serviceId === input.serviceId);
  if (!previous) {
    if (!entry || entry.fulfillmentMode !== "instant" || entry.unitGroupRestricted)
      return refused("not_available");
    if (entry.actionType !== "increase_occupancy") {
      const services = await s.engine.bookedServices(reservation.id);
      const already = services.find((service) => service.service?.id === input.serviceId);
      if ((Number(already?.dates?.[0]?.count) || 0) > 0) return refused("already_booked");
    }
    const unit = toCents(entry.unitPrice);
    const fresh = unit
      ? {
          amountCents: unit.amountCents * input.count * (entry.nights || 1),
          currency: unit.currency,
        }
      : null;
    if (!same(fresh, input.expectedPrice)) return refused("price_changed", fresh);
  }
  const result = await s.engine.placeOrder(s.context, {
    reservationId: reservation.id,
    idempotencyKey: input.idempotencyKey,
    lines: [
      {
        serviceId: input.serviceId,
        count: input.count,
        ...(input.vehiclePlates ? { vehiclePlates: input.vehiclePlates } : {}),
        ...(entry?.unitPrice && !previous ? { expectedUnitPrice: entry.unitPrice.amount } : {}),
      },
    ],
  });
  if (result.status === "in_progress") return refused("in_progress");
  if (result.status === "completed" || result.status === "partial") {
    const stored = previous?.items.find((i) => i.apaleoServiceId === input.serviceId);
    return {
      kind: "ok",
      value: {
        status: "booked",
        serviceId: input.serviceId,
        count: result.booked[0]?.count ?? stored?.quantity ?? input.count,
        serviceDates: result.booked[0]?.serviceDates ?? stored?.serviceDates ?? [],
        price: input.expectedPrice,
      },
    };
  }
  return refused(result.failed[0]?.reason ?? "booking_failed");
}

export function createEngineBridge(deps: EngineBridgeDeps): ExtrasBridge {
  async function setup(subject: BridgeSubject) {
    const resolved = await deps.engineFor(subject);
    if (!resolved) return undefined;
    const context = {
      tenantId: subject.tenantId,
      propertyId: resolved.propertyId,
      apaleoPropertyId: subject.apaleoPropertyId,
    };
    return { engine: resolved.engine, context };
  }

  return {
    async catalog(subject): Promise<BridgeResult<ExtrasCatalog>> {
      const s = await setup(subject);
      if (!s) return { kind: "unavailable" };
      try {
        const reservation = await s.engine.readReservation(subject.reservationId);
        if (!reservation || reservation.property.id !== subject.apaleoPropertyId)
          return { kind: "unavailable" };
        const catalog = await s.engine.getGuestCatalog(s.context, reservation);
        if (catalog.pastStay)
          return { kind: "ok", value: { pastStay: true, items: [], extension: null } };
        const [services, offer] = await Promise.all([
          s.engine.bookedServices(reservation.id),
          s.engine.getStayExtensionOffer(s.context, reservation.id),
        ]);
        const bookedCount = (serviceId: string) => {
          const entry = services.find((service) => service.service?.id === serviceId);
          return Number(entry?.dates?.[0]?.count) || 0;
        };
        return {
          kind: "ok",
          value: {
            pastStay: false,
            arrival: reservation.arrival.slice(0, 10),
            departure: reservation.departure.slice(0, 10),
            items: catalog.items.map((entry) => item(entry, bookedCount(entry.serviceId))),
            extension: extension(offer),
          },
        };
      } catch {
        return { kind: "unavailable" };
      }
    },

    async overview(subject): Promise<BridgeResult<ExtrasOverview>> {
      const s = await setup(subject);
      if (!s) return { kind: "unavailable" };
      try {
        const [services, catalog, records] = await Promise.all([
          s.engine.bookedServices(subject.reservationId),
          s.engine.getConfiguredCatalog(s.context),
          loadReservationServiceRecords(deps.db, s.context, {
            propertyId: s.context.propertyId,
            externalReservationId: subject.reservationId,
          }),
        ]);
        const extras = services.filter(
          (entry) =>
            entry.service?.id &&
            !entry.isMandatory &&
            !(entry.dates ?? []).some((d) => d.isMandatory),
        );
        const booked = await Promise.all(
          extras.map(async (entry) => {
            const id = entry.service?.id ?? "";
            const configured = catalog.find((c) => c.serviceId === id);
            const name = configured?.title.de
              ? { de: configured.title.de, en: configured.title.en || configured.title.de }
              : ((await s.engine.serviceName(id)) ?? { de: id, en: id });
            const dates = entry.dates ?? [];
            const total = dates.reduce((sum, d) => sum + (Number(d.amount?.grossAmount) || 0), 0);
            return {
              serviceId: id,
              name: { de: name.de || id, en: name.en || name.de || id },
              count: Number(dates[0]?.count) || 0,
              dates: dates.map((d) => d.serviceDate ?? "").filter(Boolean),
              total: dates.length
                ? {
                    amountCents: Math.round(total * 100),
                    currency: dates[0]?.amount?.currency ?? "EUR",
                  }
                : null,
            };
          }),
        );
        return {
          kind: "ok",
          value: {
            booked,
            amendments: records.amendments.map((a) => {
              const configured = catalog.find((c) => c.serviceId === a.serviceId);
              const de = configured?.title.de || a.displayName;
              return {
                serviceId: a.serviceId,
                name: { de, en: configured?.title.en || de },
                count: a.quantity,
                total:
                  a.amountCents === null
                    ? null
                    : { amountCents: a.amountCents, currency: a.currency ?? "EUR" },
                createdAt: a.createdAt.toISOString(),
              };
            }),
            requests: records.requests.map((r) => ({
              requestId: r.id,
              serviceId: r.serviceId ?? "",
              serviceName: r.title.de ?? null,
              quantity: r.quantity,
              status:
                r.status === "confirmed"
                  ? "approved"
                  : r.status === "pending"
                    ? "pending"
                    : "rejected",
              createdAt: r.createdAt.toISOString(),
              decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
            })),
            extensions: records.extensions.map((e) => ({
              newDeparture: e.newDeparture,
              status: e.status,
            })),
          },
        };
      } catch {
        return { kind: "unavailable" };
      }
    },

    async order(subject, input) {
      const s = await setup(subject);
      if (!s) return { kind: "unavailable" };
      try {
        const outcome = await s.engine.exclusive(
          s.context,
          `guestorder:${subject.reservationId}:${input.serviceId}`,
          () => placeOrder(deps.db, s, subject, input),
        );
        return outcome === "in_progress" ? refused("in_progress") : outcome;
      } catch {
        return { kind: "unavailable" };
      }
    },

    async request(subject, input: RequestInput) {
      const s = await setup(subject);
      if (!s) return { kind: "unavailable" };
      const result = await s.engine.createRequest(s.context, {
        reservationId: subject.reservationId,
        serviceId: input.serviceId,
        quantity: input.quantity,
        idempotencyKey: input.idempotencyKey,
      });
      return result.ok
        ? {
            kind: "ok",
            value: { status: "pending", requestId: result.requestId, serviceId: input.serviceId },
          }
        : refused(result.reason);
    },

    async extend(subject, input: ExtensionInput) {
      const s = await setup(subject);
      if (!s) return { kind: "unavailable" };
      try {
        const offer = extension(
          await s.engine.getStayExtensionOffer(s.context, subject.reservationId),
        );
        if (!offer || offer.currentDeparture !== input.currentDeparture)
          return refused("not_available");
        if (!same(offer.totalPrice, input.expectedPrice))
          return refused("price_changed", offer.totalPrice);
        const result = await s.engine.confirmStayExtension(s.context, {
          reservationId: subject.reservationId,
          expectedCurrentDeparture: input.currentDeparture,
        });
        return result.ok
          ? {
              kind: "ok",
              value: {
                status: "booked",
                newDeparture: result.newDeparture,
                price: toCents(result.extensionPrice),
              },
            }
          : refused(result.reason);
      } catch {
        return { kind: "unavailable" };
      }
    },
  };
}
