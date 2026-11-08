/**
 * STAY service booking engine (Extras migration M3).
 *
 * The Extras business logic, step by step and in the same order (aurelsommerlad/guest-services
 * lib/guest.js getGuestCatalog, placeGuestOrder, increaseReservationOccupancy,
 * recordParkingVehiclePlates, determineConsecutiveFreeNights, getStayExtensionOffer,
 * confirmStayExtension; lib/requests.js createGuestRequest, approveRequest). Every rule is the
 * M1 port in @up/core – nothing is re-implemented here; this file only orchestrates reads,
 * claims, gateway writes and records.
 *
 * Deliberate differences to Extras (documented in docs/staging/extras-migration-m3-paritaet.md):
 *   - every write goes through the ServiceWriteGateway (idempotency key per write, policy, log);
 *   - claims expire after LOCK_TTL_MS (Extras claims never expire after a crash);
 *   - optional `expectedUnitPrice` per order line: a price change since display fails the line
 *     instead of booking the new price silently (Extras books the new price);
 *   - a guest order carries a client idempotency key: double submits replay the stored result;
 *   - STAY texts (offer title/teaser) instead of Apaleo-localized service names;
 *   - unpublished offers are hidden unless `includeUnpublished` (shadow comparison).
 */
import {
  addOneDay,
  type ApaleoBookedService,
  type ApaleoServiceOffer,
  buildExtensionOffer,
  buildExtensionPricePreview,
  buildExtraPersonPricing,
  buildLateCheckoutMoveDates,
  buildOccupancyAmendmentPayload,
  buildPrimaryVehicleRegistration,
  buildServiceExtensionDates,
  buildStayExtensionAmendmentPayload,
  compareBySortOrder,
  compareExistingBooking,
  computeExtensionAdditionalTotal,
  countBookedServiceQuantity,
  datesWithoutAvailability,
  DEFAULT_VEHICLE_COUNTRY_CODE,
  determineStayExtensionPhase,
  enumerateNights,
  extractOfferPrice,
  findCityTaxAmount,
  findDepartureDateCandidates,
  findExtendableServices,
  formatVehiclePlatesComment,
  getArrivalDate,
  getDepartureDate,
  getRemainingCapacity,
  getReservationUnitGroupId,
  hasReachedDogLimit,
  isLateCheckoutMoveEligible,
  isPastDate,
  isUnitGroupAllowed,
  type Money,
  normalizeVehiclePlates,
  PmsError,
  resolveBilingualPriceUnitLabel,
  resolveBilingualText,
  resolveRequiredDates,
  round2,
  type StayExtensionSettings,
  verifyLateCheckoutMove,
} from "@up/core";

import {
  type ApaleoServiceReader,
  type ReservationForServices,
} from "../apaleo/services/service-reader";
import {
  type ServiceWriteCommand,
  type ServiceWriteGateway,
  type ServiceWriteRequest,
} from "../apaleo/services/write-gateway";
import {
  type Bilingual,
  type EngineCatalogItem,
  type EngineContext,
  type ServiceLockStore,
  type ServiceRecordStore,
} from "./ports";

export const LOCK_TTL_MS = 120_000;
/** A processing guest order older than this may be resumed by a retry with the same key. */
export const ORDER_LEASE_MS = 120_000;

export type GuestCatalogItem = {
  offerId: string;
  serviceId: string;
  displayName: Bilingual;
  description: Bilingual;
  category: string;
  imageUrl: string | null;
  bookingRule: string;
  actionType: "service" | "increase_occupancy";
  fulfillmentMode: "instant" | "request";
  priceUnitLabel: Bilingual;
  unitPrice: Money | null;
  nights: number;
  price: Money | null;
  serviceDates: string[] | null;
  unitGroupRestricted: boolean;
  maxQuantity: number | null;
  maxOnePerReservation: boolean;
  alreadyBooked: boolean;
  requiresVehicleRegistration: boolean;
  existingVehicleRegistration: string | null;
};

/** Why a configured item is not shown (shadow diagnostics; Extras just skips them). */
export type HiddenReason =
  | "inactive"
  | "unpublished"
  | "no_capacity"
  | "invalid_extra_person_price"
  | "no_offer"
  | "incomplete_dates";

export type GuestCatalog = {
  items: GuestCatalogItem[];
  pastStay: boolean;
  hidden: { serviceId: string; offerId: string; reason: HiddenReason }[];
};

export type OrderLine = {
  serviceId: string;
  /** Untyped guest input (as in Extras: Number(line.count) || 0). */
  count: unknown;
  vehiclePlates?: readonly unknown[];
  /** Unit price the guest saw; a different live price fails the line (price_changed). */
  expectedUnitPrice?: number;
};

export type OrderFailure = { serviceId: string; reason: string };

export type OrderResult =
  | {
      status: "completed" | "partial" | "failed";
      bookingId: string;
      replayed: boolean;
      simulated: boolean;
      booked: (GuestCatalogItem & { count: number })[];
      failed: OrderFailure[];
    }
  | { status: "in_progress"; bookingId: string };

export type StayExtensionOffer = NonNullable<ReturnType<typeof buildExtensionOffer>> & {
  extras: { serviceId: string; name: Bilingual; amount: Money }[];
  cityTax: Money | null;
  totalPrice: Money;
};

export type EngineOptions = {
  reader: ApaleoServiceReader;
  gateway: ServiceWriteGateway;
  records: ServiceRecordStore;
  locks: ServiceLockStore;
  now?: () => Date;
  newId?: () => string;
  /**
   * After simulated writes Apaleo has not changed, so read-back checks (new departure, moved
   * Late Check-out) cannot pass. "skip" records them as not verifiable; "check" verifies (a
   * harness whose Apaleo double applies simulated writes).
   */
  verifySimulatedWrites?: "skip" | "check";
};

class EngineError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

function errorReason(error: unknown): string {
  if (error instanceof EngineError) return error.reason;
  if (error instanceof PmsError) return `apaleo_${error.kind.replace("-", "_")}`;
  return "unexpected_error";
}

function cents(money: Money | null | undefined, factor = 1): number | null {
  if (!money || !Number.isFinite(money.amount)) return null;
  return Math.round(money.amount * factor * 100);
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(date);
}

function mandatoryServiceIds(services: readonly ApaleoBookedService[]): Set<string> {
  return new Set(
    services
      .filter((entry) => (entry.dates ?? []).some((d) => d.isMandatory))
      .map((entry) => entry.service?.id)
      .filter((id): id is string => Boolean(id)),
  );
}

export class ServiceBookingEngine {
  readonly #reader: ApaleoServiceReader;
  readonly #gateway: ServiceWriteGateway;
  readonly #records: ServiceRecordStore;
  readonly #locks: ServiceLockStore;
  readonly #now: () => Date;
  readonly #newId: () => string;
  readonly #verifySimulated: "skip" | "check";

  constructor(options: EngineOptions) {
    this.#reader = options.reader;
    this.#gateway = options.gateway;
    this.#records = options.records;
    this.#locks = options.locks;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => crypto.randomUUID());
    this.#verifySimulated = options.verifySimulatedWrites ?? "skip";
  }

  get mode() {
    return this.#gateway.mode;
  }

  /** Reads a reservation (read-only); unknown → null. */
  async readReservation(reservationId: string): Promise<ReservationForServices | null> {
    try {
      return await this.#reader.getReservation(reservationId);
    } catch (error) {
      if (error instanceof PmsError && error.kind === "not-found") return null;
      throw error;
    }
  }

  /* ── Catalog (Extras getGuestCatalog) ────────────────────────────────────────────────── */

  async getGuestCatalog(
    context: EngineContext,
    reservation: ReservationForServices,
    options: { includeUnpublished?: boolean } = {},
  ): Promise<GuestCatalog> {
    const hidden: GuestCatalog["hidden"] = [];
    const configured = await this.#records.loadCatalog(context);
    const curated = configured.filter((item) => {
      if (!item.active) {
        hidden.push({ serviceId: item.serviceId, offerId: item.offerId, reason: "inactive" });
        return false;
      }
      if (!item.published && !options.includeUnpublished) {
        hidden.push({ serviceId: item.serviceId, offerId: item.offerId, reason: "unpublished" });
        return false;
      }
      return true;
    });
    if (!curated.length) return { items: [], pastStay: false, hidden };

    const departureDate = getDepartureDate(reservation);
    const { items: offers, pastStay } = await this.#reader.getServiceOffersForStay(
      reservation.id,
      departureDate,
      this.#now(),
    );
    if (pastStay) return { items: [], pastStay: true, hidden };

    const offersByServiceId = new Map<string, ApaleoServiceOffer>();
    for (const offer of offers) offersByServiceId.set(offer.service.id, offer);

    const unitGroupId = getReservationUnitGroupId(reservation);
    let remainingCapacity = 0;
    if (
      curated.some(
        (item) => item.requiresRemainingCapacity || item.actionType === "increase_occupancy",
      )
    ) {
      const unitGroup = unitGroupId ? await this.#unitGroupOrNull(unitGroupId) : null;
      remainingCapacity = getRemainingCapacity(unitGroup, reservation);
    }

    const dogIds = curated.filter((i) => i.maxOnePerReservation).map((i) => i.serviceId);
    const bookedQuantities = new Map<string, number>();
    if (dogIds.length) {
      const existing = await this.#reader.getBookedServices(reservation.id);
      for (const id of dogIds) bookedQuantities.set(id, countBookedServiceQuantity(existing, id));
    }

    type Candidate = {
      item: EngineCatalogItem;
      bookingRule: string;
      nights: number;
      unitPrice: Money | null;
      price: Money | null;
      serviceDates: string[] | null;
    };
    const candidates: Candidate[] = [];
    for (const item of curated) {
      const skip = (reason: HiddenReason) =>
        hidden.push({ serviceId: item.serviceId, offerId: item.offerId, reason });
      if (item.actionType === "increase_occupancy") {
        if (remainingCapacity <= 0) {
          skip("no_capacity");
          continue;
        }
        const nights = enumerateNights(
          getArrivalDate(reservation),
          getDepartureDate(reservation),
        ).length;
        const pricing = buildExtraPersonPricing({
          pricePerNight: item.extraPersonPricePerNight,
          nights,
          currency: item.currency ?? undefined,
        });
        if (!pricing) {
          skip("invalid_extra_person_price");
          continue;
        }
        candidates.push({
          item,
          bookingRule: "per_person_per_night",
          nights: pricing.nights,
          unitPrice: pricing.unitPrice,
          price: pricing.price,
          serviceDates: null,
        });
        continue;
      }
      const offer = offersByServiceId.get(item.serviceId);
      if (!offer) {
        skip("no_offer");
        continue;
      }
      if (item.requiresRemainingCapacity && remainingCapacity <= 0) {
        skip("no_capacity");
        continue;
      }
      const bookingRule = item.bookingRule;
      const { dates, complete } = resolveRequiredDates(bookingRule, offer, reservation);
      if (!complete) {
        skip("incomplete_dates");
        continue;
      }
      const nights = bookingRule === "per_night" ? dates.length : 1;
      const unitPrice = extractOfferPrice(offer, dates[0]);
      const price = unitPrice
        ? { amount: round2(unitPrice.amount * nights), currency: unitPrice.currency }
        : null;
      candidates.push({ item, bookingRule, nights, unitPrice, price, serviceDates: dates });
    }
    candidates.sort((a, b) => compareBySortOrder(a.item, b.item));

    const items = candidates.map(
      ({ item, bookingRule, nights, unitPrice, price, serviceDates }) => {
        const booked = bookedQuantities.get(item.serviceId) ?? 0;
        const capacityGated =
          item.requiresRemainingCapacity || item.actionType === "increase_occupancy";
        return {
          offerId: item.offerId,
          serviceId: item.serviceId,
          // STAY texts; a missing language falls back to the other one (never to the id).
          displayName: resolveBilingualText({
            overrideDe: item.title.de,
            overrideEn: item.title.en,
            apaleoDe: item.title.de,
            apaleoEn: item.title.en,
            finalFallback: item.serviceId,
          }),
          description: resolveBilingualText({
            overrideDe: item.description.de,
            overrideEn: item.description.en,
            apaleoDe: item.description.de,
            apaleoEn: item.description.en,
            finalFallback: "",
          }),
          category: item.category,
          imageUrl: item.imageUrl,
          bookingRule,
          actionType: item.actionType,
          fulfillmentMode: item.fulfillment,
          priceUnitLabel: resolveBilingualPriceUnitLabel({
            overrideDe: item.priceUnitLabel?.de,
            overrideEn: item.priceUnitLabel?.en,
            bookingRule,
          }),
          unitPrice,
          nights,
          price,
          serviceDates,
          unitGroupRestricted: !isUnitGroupAllowed(item.allowedUnitGroupIds, unitGroupId),
          maxQuantity: capacityGated
            ? remainingCapacity
            : item.maxOnePerReservation
              ? booked >= 1
                ? 0
                : 1
              : null,
          maxOnePerReservation: item.maxOnePerReservation,
          alreadyBooked: item.maxOnePerReservation ? booked >= 1 : false,
          requiresVehicleRegistration: item.requiresVehicleRegistration,
          existingVehicleRegistration: item.requiresVehicleRegistration
            ? (reservation.primaryGuest?.vehicleRegistration?.number ?? null)
            : null,
        } satisfies GuestCatalogItem;
      },
    );
    return { items, pastStay: false, hidden };
  }

  /* ── Guest order (Extras placeGuestOrder) ─────────────────────────────────────────────── */

  async placeOrder(
    context: EngineContext,
    input: { reservationId: string; idempotencyKey: string; lines: readonly OrderLine[] },
  ): Promise<OrderResult> {
    const now = this.#now();
    const begin = await this.#records.beginBooking({
      tenantId: context.tenantId,
      propertyId: context.propertyId,
      externalReservationId: input.reservationId,
      idempotencyKey: input.idempotencyKey,
      now,
      leaseMs: ORDER_LEASE_MS,
    });
    if (begin.kind === "in-progress") return { status: "in_progress", bookingId: begin.id };
    if (begin.kind === "done") {
      return {
        status: begin.status,
        bookingId: begin.id,
        replayed: true,
        simulated: this.mode === "simulated",
        booked: [],
        failed: begin.items
          .filter((i) => i.status === "failed")
          .map((i) => ({ serviceId: i.serviceId, reason: i.errorCode ?? "failed" })),
      };
    }
    const bookingId = begin.id;
    const booked: (GuestCatalogItem & { count: number })[] = [];
    const failed: OrderFailure[] = [];

    let reservation: ReservationForServices;
    let catalog: GuestCatalog;
    try {
      reservation = await this.#reader.getReservation(input.reservationId);
      if (reservation.property.id !== context.apaleoPropertyId)
        throw new EngineError("reservation_property_mismatch");
      catalog = await this.getGuestCatalog(context, reservation);
    } catch (error) {
      for (const line of input.lines)
        failed.push({ serviceId: line.serviceId, reason: errorReason(error) });
      await this.#records.finishBooking({
        tenantId: context.tenantId,
        bookingId,
        status: "failed",
        totalCents: null,
        currency: null,
        now: this.#now(),
      });
      return { status: "failed", bookingId, replayed: false, simulated: false, booked, failed };
    }

    const available = new Map(
      catalog.items.filter((i) => i.fulfillmentMode === "instant").map((i) => [i.serviceId, i]),
    );
    const record = (
      item: GuestCatalogItem | undefined,
      line: OrderLine,
      status: "booked" | "failed",
      errorCode: string | null,
    ) =>
      this.#records.saveBookingItem({
        tenantId: context.tenantId,
        bookingId,
        offerId: item?.offerId ?? null,
        serviceId: line.serviceId,
        displayName: item?.displayName.de ?? line.serviceId,
        actionType: item?.actionType ?? "service",
        quantity: Math.min(Math.max(Math.trunc(Number(line.count)) || 1, 1), 50),
        serviceDates: item?.serviceDates ?? [],
        amountCents: cents(item?.price, Number(line.count) || 1),
        currency: item?.price?.currency ?? null,
        status,
        errorCode,
      });
    const fail = async (line: OrderLine, reason: string, item?: GuestCatalogItem) => {
      failed.push({ serviceId: line.serviceId, reason });
      await record(item, line, "failed", reason.replace(/[^a-z0-9_]/g, "_").slice(0, 60));
    };

    for (const line of input.lines) {
      const item = available.get(line.serviceId);
      const count = Number(line.count) || 0;
      const isOccupancy = item?.actionType === "increase_occupancy";
      const serviceDates = item?.serviceDates ?? [];
      if (!item || count <= 0 || (!isOccupancy && !serviceDates.length)) {
        await fail(line, "not_available", item);
        continue;
      }
      if (item.unitGroupRestricted) {
        await fail(line, "unit_group_restricted", item);
        continue;
      }
      if (item.maxOnePerReservation) {
        if (count !== 1) {
          await fail(line, "dog_limit_exceeded", item);
          continue;
        }
      } else if (item.maxQuantity !== null && count > item.maxQuantity) {
        await fail(line, "capacity_exceeded", item);
        continue;
      }
      let plates: string[] | null = null;
      if (item.requiresVehicleRegistration) {
        plates = normalizeVehiclePlates(line.vehiclePlates, count);
        if (!plates) {
          await fail(line, "vehicle_registration_required", item);
          continue;
        }
      }
      if (
        line.expectedUnitPrice !== undefined &&
        (!item.unitPrice || round2(line.expectedUnitPrice) !== round2(item.unitPrice.amount))
      ) {
        await fail(line, "price_changed", item);
        continue;
      }
      try {
        if (isOccupancy)
          await this.#increaseOccupancy(context, bookingId, reservation, item, count);
        else await this.#bookServiceLine(context, bookingId, reservation, item, count, plates);
        booked.push({ ...item, count });
        await record(item, line, "booked", null);
      } catch (error) {
        await fail(line, errorReason(error), item);
      }
    }

    let totalCents: number | null = null;
    if (booked.length) {
      totalCents = booked.reduce((sum, b) => sum + (cents(b.price, b.count) ?? 0), 0);
      const summary = booked.map((b) => `${String(b.count)}x ${b.displayName.de}`).join(", ");
      // A comment failure never rolls back booked services (as in Extras).
      await this.#write(context, reservation.id, `order:${bookingId}:comment`, {
        operation: "append-comment",
        text: `[Gäste-Portal ${formatDateTime(this.#now())}] Extras gebucht: ${summary}`,
      }).catch(() => undefined);
      await this.#records.notify({
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        template: "service.order",
        dedupKey: `service-order:${bookingId}`,
        payload: {
          bookingId,
          items: booked.map((b) => ({ serviceId: b.serviceId, count: b.count })),
        },
      });
    }
    const status = !booked.length ? "failed" : failed.length ? "partial" : "completed";
    await this.#records.finishBooking({
      tenantId: context.tenantId,
      bookingId,
      status,
      totalCents,
      currency: booked[0]?.price?.currency ?? null,
      now: this.#now(),
    });
    return {
      status,
      bookingId,
      replayed: false,
      simulated: this.mode === "simulated",
      booked,
      failed,
    };
  }

  async #increaseOccupancy(
    context: EngineContext,
    bookingId: string,
    reservation: ReservationForServices,
    item: GuestCatalogItem,
    count: number,
  ) {
    await this.#withLock(context, `occ:${reservation.id}:${item.serviceId}`, async () => {
      const fresh = await this.#reader.getReservation(reservation.id);
      const unitGroupId = getReservationUnitGroupId(fresh);
      const unitGroup = unitGroupId ? await this.#unitGroupOrNull(unitGroupId) : null;
      if (count > getRemainingCapacity(unitGroup, fresh))
        throw new EngineError("capacity_exceeded");
      const payload = buildOccupancyAmendmentPayload({
        reservation: fresh,
        timeSlices: fresh.timeSlices,
        extraPersonPricePerNight: item.unitPrice?.amount,
        additionalPersonCount: count,
      });
      if (!payload) throw new EngineError("amendment_not_safe");
      await this.#mustWrite(context, reservation.id, `order:${bookingId}:${item.serviceId}:amend`, {
        operation: "amend-occupancy",
        payload,
      });
    });
  }

  async #bookServiceLine(
    context: EngineContext,
    bookingId: string,
    reservation: ReservationForServices,
    item: GuestCatalogItem,
    count: number,
    plates: string[] | null,
  ) {
    const book = async () => {
      if (item.maxOnePerReservation) {
        const fresh = await this.#reader.getBookedServices(reservation.id);
        if (hasReachedDogLimit(fresh, item.serviceId)) throw new EngineError("dog_limit_exceeded");
      }
      const run = async () => {
        if (plates) {
          const primary = buildPrimaryVehicleRegistration(plates, DEFAULT_VEHICLE_COUNTRY_CODE);
          if (primary) {
            const saved = await this.#write(
              context,
              reservation.id,
              `order:${bookingId}:${item.serviceId}:vehicle`,
              { operation: "update-vehicle", ...primary },
            );
            if (!saved.ok) throw new EngineError("vehicle_registration_failed");
            const comment = formatVehiclePlatesComment(plates);
            if (comment) {
              await this.#write(
                context,
                reservation.id,
                `order:${bookingId}:${item.serviceId}:plates`,
                { operation: "append-comment", text: comment },
              ).catch(() => undefined);
            }
          }
        }
        await this.#mustWrite(
          context,
          reservation.id,
          `order:${bookingId}:${item.serviceId}:book`,
          {
            operation: "book-service",
            serviceId: item.serviceId,
            count,
            dates: (item.serviceDates ?? []).map((serviceDate) => ({
              serviceDate,
              count,
              ...(item.unitPrice
                ? { amount: { amount: item.unitPrice.amount, currency: item.unitPrice.currency } }
                : {}),
            })),
          },
        );
      };
      if (plates) await this.#withLock(context, `vehicle:${reservation.id}:${item.serviceId}`, run);
      else await run();
    };
    if (item.maxOnePerReservation)
      await this.#withLock(context, `dog:${reservation.id}:${item.serviceId}`, book);
    else await book();
  }

  /* ── Requests (Extras createGuestRequest / approveRequest / rejectRequest) ───────────── */

  async createRequest(
    context: EngineContext,
    input: { reservationId: string; serviceId: string; quantity: unknown },
  ): Promise<{ ok: true; requestId: string } | { ok: false; reason: string }> {
    const quantity = Number(input.quantity) || 1;
    if (quantity <= 0) return { ok: false, reason: "invalid_quantity" };
    try {
      const reservation = await this.#reader.getReservation(input.reservationId);
      if (reservation.property.id !== context.apaleoPropertyId)
        return { ok: false, reason: "reservation_property_mismatch" };
      const { items } = await this.getGuestCatalog(context, reservation);
      const item = items.find(
        (i) => i.serviceId === input.serviceId && i.fulfillmentMode === "request",
      );
      if (!item) return { ok: false, reason: "not_available" };
      if (item.unitGroupRestricted) return { ok: false, reason: "unit_group_restricted" };
      const { id } = await this.#records.createRequest({
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        externalReservationId: reservation.id,
        offerId: item.offerId,
        apaleoServiceId: item.serviceId,
        quantity,
        requestedDates: item.serviceDates ?? [],
        quotedCents: cents(item.price ?? item.unitPrice),
        currency: (item.price ?? item.unitPrice)?.currency ?? null,
        now: this.#now(),
      });
      await this.#records.notify({
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        template: "service.request",
        dedupKey: `service-request:${id}`,
        payload: { requestId: id, serviceId: item.serviceId, quantity },
      });
      return { ok: true, requestId: id };
    } catch (error) {
      return { ok: false, reason: errorReason(error) };
    }
  }

  /**
   * Staff approval: re-verifies against live Apaleo exactly like Extras approveRequest, then one
   * book-service with every required date (no amount: Apaleo's price, as in Extras).
   */
  async approveRequest(
    context: EngineContext,
    requestId: string,
    actorAdminId: string | null,
  ): Promise<
    { ok: true; alreadyBooked: boolean; simulated: boolean } | { ok: false; reason: string }
  > {
    const holder = this.#newId();
    const processKey = `reqproc:${requestId}`;
    if (!(await this.#claim(context, processKey, holder)))
      return { ok: false, reason: "in_progress" };
    try {
      const request = await this.#records.getRequest(context, requestId);
      if (!request || request.propertyId !== context.propertyId)
        return { ok: false, reason: "not_found" };
      if (request.source === "extras") return { ok: false, reason: "handled_in_extras" };
      if (request.status !== "pending") return { ok: false, reason: "not_pending" };
      const serviceId = request.apaleoServiceId;
      const quantity = request.quantity ?? 1;
      if (!serviceId) return { ok: false, reason: "not_a_service_request" };

      let reservation: ReservationForServices;
      let requiredDates: string[];
      let item: EngineCatalogItem | undefined;
      try {
        reservation = await this.#reader.getReservation(request.externalReservationId);
        if (reservation.property.id !== context.apaleoPropertyId)
          return { ok: false, reason: "reservation_property_mismatch" };
        const { items: offers, pastStay } = await this.#reader.getServiceOffersForStay(
          reservation.id,
          getDepartureDate(reservation),
          this.#now(),
        );
        if (pastStay) return { ok: false, reason: "past_stay" };
        const offer = offers.find((o) => o.service.id === serviceId) as
          ApaleoServiceOffer | undefined;
        if (!offer) return { ok: false, reason: "no_offer" };
        item = (await this.#records.loadCatalog(context)).find((i) => i.serviceId === serviceId);
        if (!item?.active) return { ok: false, reason: "inactive" };
        if (item.maxOnePerReservation && quantity !== 1)
          return { ok: false, reason: "dog_limit_exceeded" };
        const unitGroupId = getReservationUnitGroupId(reservation);
        if (!isUnitGroupAllowed(item.allowedUnitGroupIds, unitGroupId))
          return { ok: false, reason: "unit_group_restricted" };
        if (item.requiresRemainingCapacity) {
          const unitGroup = unitGroupId ? await this.#unitGroupOrNull(unitGroupId) : null;
          if (quantity > getRemainingCapacity(unitGroup, reservation))
            return { ok: false, reason: "capacity_exceeded" };
        }
        const resolved = resolveRequiredDates(item.bookingRule, offer, reservation);
        requiredDates = resolved.dates;
        if (!resolved.complete) return { ok: false, reason: "incomplete_dates" };
        const firstRequested = request.requestedDates?.[0];
        if (firstRequested && !requiredDates.includes(firstRequested))
          return { ok: false, reason: "requested_date_unavailable" };
        if (datesWithoutAvailability(offer, requiredDates, quantity).length)
          return { ok: false, reason: "insufficient_availability" };
      } catch (error) {
        return { ok: false, reason: errorReason(error) };
      }

      const catalogItem = item;
      const state = { alreadyBooked: false, simulated: false };
      const book = async (): Promise<string | null> => {
        const fresh = (await this.#reader.getBookedServices(
          reservation.id,
        )) as ApaleoBookedService[];
        const existing = compareExistingBooking(fresh, serviceId, requiredDates, quantity);
        if (
          catalogItem.maxOnePerReservation &&
          hasReachedDogLimit(fresh, serviceId) &&
          existing !== "complete"
        )
          return "dog_limit_exceeded";
        if (existing === "conflict") return "existing_booking_conflict";
        state.alreadyBooked = existing === "complete";
        if (state.alreadyBooked) return null;
        const result = await this.#write(
          context,
          reservation.id,
          `req:${requestId}:book`,
          {
            operation: "book-service",
            serviceId,
            count: quantity,
            dates: requiredDates.map((serviceDate) => ({ serviceDate, count: quantity })),
          },
          actorAdminId,
        );
        if (!result.ok) return `booking_failed:${result.code}`;
        state.simulated = result.simulated;
        return null;
      };
      let failure: string | null;
      try {
        const inner = () => this.#withLock(context, `reqbook:${reservation.id}:${serviceId}`, book);
        failure = catalogItem.maxOnePerReservation
          ? await this.#withLock(context, `dog:${reservation.id}:${serviceId}`, inner)
          : await inner();
      } catch (error) {
        failure = errorReason(error);
      }
      if (failure) return { ok: false, reason: failure };

      if (!state.alreadyBooked) {
        await this.#write(
          context,
          reservation.id,
          `req:${requestId}:comment`,
          {
            operation: "append-comment",
            text: `[Gäste-Portal ${formatDateTime(this.#now())}] Anfrage bestätigt: ${String(quantity)}x ${request.serviceName}`,
          },
          actorAdminId,
        ).catch(() => undefined);
      }
      const done = await this.#records.completeRequest({
        tenantId: context.tenantId,
        requestId,
        decision: "confirm",
        bookedServiceDates: requiredDates,
        actorAdminId,
        now: this.#now(),
      });
      if (!done.ok) return { ok: false, reason: done.reason.replace(/-/g, "_") };
      return { ok: true, alreadyBooked: state.alreadyBooked, simulated: state.simulated };
    } finally {
      await this.#locks.release({ tenantId: context.tenantId, key: processKey, holder });
    }
  }

  async rejectRequest(
    context: EngineContext,
    requestId: string,
    actorAdminId: string | null,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const request = await this.#records.getRequest(context, requestId);
    if (!request || request.propertyId !== context.propertyId)
      return { ok: false, reason: "not_found" };
    const done = await this.#records.completeRequest({
      tenantId: context.tenantId,
      requestId,
      decision: "decline",
      actorAdminId,
      now: this.#now(),
    });
    return done.ok ? done : { ok: false, reason: done.reason.replace(/-/g, "_") };
  }

  /* ── Stay extension (Extras getStayExtensionOffer / confirmStayExtension) ─────────────── */

  async #consecutiveFreeNights(input: {
    apaleoPropertyId: string;
    unitGroupId: string;
    assignedUnitId: string | null;
    departureDate: string;
    minSellableStayNights: number;
  }): Promise<number> {
    const lookahead = Math.max(input.minSellableStayNights || 0, 0) + 1;
    let rangeEnd: string | null = input.departureDate;
    for (let i = 0; i < lookahead && rangeEnd; i++) rangeEnd = addOneDay(rangeEnd);
    if (!rangeEnd) return 0;
    const nightly = await this.#reader.getUnitGroupNightlyAvailability(
      input.apaleoPropertyId,
      input.unitGroupId,
      input.departureDate,
      rangeEnd,
    );
    let gap = 0;
    for (const entry of nightly) {
      const group = entry.unitGroups?.[0];
      if (!group || !(Number(group.availableCount) > 0)) break;
      if (input.assignedUnitId) {
        const free = await this.#reader.isUnitAvailable(
          input.apaleoPropertyId,
          input.unitGroupId,
          input.assignedUnitId,
          entry.from,
          entry.to,
        );
        if (!free) break;
      } else if (Number(group.physicalCount) !== 1) {
        break;
      }
      gap += 1;
    }
    return gap;
  }

  /** Offer eligibility + price; null whenever any condition fails (fail closed). */
  async #computeExtension(
    context: EngineContext,
    fresh: ReservationForServices,
    config: StayExtensionSettings,
  ) {
    if (!config.extensionNightEnabled) return null;
    const allowed =
      (fresh.actions ?? []).find((a) => a.action === "AmendDeparture")?.isAllowed === true;
    if (!allowed) return null;
    const departureDate = getDepartureDate(fresh);
    if (!departureDate || isPastDate(departureDate, this.#now())) return null;
    const unitGroupId = getReservationUnitGroupId(fresh);
    if (!unitGroupId) return null;
    const arrivalDate = getArrivalDate(fresh);
    const phase = determineStayExtensionPhase({
      status: fresh.status,
      arrivalDate,
      departureDate,
      today: this.#now(),
    });
    const gap = await this.#consecutiveFreeNights({
      apaleoPropertyId: context.apaleoPropertyId,
      unitGroupId,
      assignedUnitId: fresh.unit?.id ?? null,
      departureDate,
      minSellableStayNights: config.minSellableStayNights,
    });
    const offer = buildExtensionOffer({
      reservation: fresh,
      timeSlices: fresh.timeSlices ?? [],
      gap,
      config,
      phase,
    });
    return offer ? { offer, arrivalDate, departureDate } : null;
  }

  async getStayExtensionOffer(
    context: EngineContext,
    reservationId: string,
  ): Promise<StayExtensionOffer | null> {
    try {
      const config = await this.#records.getExtensionSettings(context);
      if (!config.extensionNightEnabled) return null;
      const fresh = await this.#reader.getReservationForExtension(reservationId);
      if (!fresh || fresh.property.id !== context.apaleoPropertyId) return null;
      const computed = await this.#computeExtension(context, fresh, config);
      if (!computed) return null;
      return await this.#attachPreview(
        computed.offer,
        fresh,
        computed.arrivalDate,
        computed.departureDate,
      );
    } catch {
      // Never let this optional upsell break the catalog (as in Extras).
      return null;
    }
  }

  async #attachPreview(
    offer: NonNullable<ReturnType<typeof buildExtensionOffer>>,
    reservation: ReservationForServices,
    arrivalDate: string | null,
    departureDate: string,
  ): Promise<StayExtensionOffer> {
    let extras: StayExtensionOffer["extras"] = [];
    let cityTax: Money | null = null;
    try {
      const services = (await this.#reader.getBookedServices(
        reservation.id,
      )) as ApaleoBookedService[];
      const { toExtend } = findExtendableServices({
        services,
        arrivalDate,
        oldDepartureDate: departureDate,
        newDate: departureDate,
      });
      const localized = await Promise.all(
        toExtend.map((s) => this.#reader.getServiceLocalized(s.serviceId)),
      );
      extras = toExtend.map((s, i) => ({
        serviceId: s.serviceId,
        name: resolveBilingualText({
          apaleoDe: localized[i]?.name.de,
          apaleoEn: localized[i]?.name.en,
          genericFallback: typeof s.name === "string" ? s.name : "",
          finalFallback: s.serviceId,
        }),
        amount: s.normalPricePerNight,
      }));
      if (reservation.hasCityTax) {
        const folios = await this.#reader.listReservationFolios(reservation.id);
        const lastNight = enumerateNights(arrivalDate, departureDate).at(-1);
        cityTax = lastNight ? findCityTaxAmount(folios, lastNight) : null;
      }
    } catch {
      // A missing preview never fails the offer (as in Extras).
    }
    const totalPrice = buildExtensionPricePreview({
      extensionPrice: offer.extensionPrice,
      extras,
      cityTax,
    });
    return { ...offer, extras, cityTax, totalPrice };
  }

  async confirmStayExtension(
    context: EngineContext,
    input: { reservationId: string; expectedCurrentDeparture: string },
  ): Promise<
    | { ok: true; newDeparture: string; extensionPrice: Money; status: string; simulated: boolean }
    | { ok: false; reason: string }
  > {
    const unavailable = { ok: false as const, reason: "stay_extension_unavailable" };
    const holder = this.#newId();
    const lockKey = `ext:${input.reservationId}`;
    if (!(await this.#claim(context, lockKey, holder))) return unavailable;
    try {
      const fresh = await this.#reader.getReservationForExtension(input.reservationId);
      if (!fresh || fresh.property.id !== context.apaleoPropertyId) return unavailable;
      const currentDeparture = getDepartureDate(fresh);
      if (!currentDeparture || currentDeparture !== input.expectedCurrentDeparture)
        return unavailable;
      const config = await this.#records.getExtensionSettings(context);
      const computed = await this.#computeExtension(context, fresh, config);
      if (!computed) return unavailable;
      const { offer, arrivalDate } = computed;
      const payload = buildStayExtensionAmendmentPayload({
        reservation: fresh,
        timeSlices: fresh.timeSlices,
        extensionPrice: offer.extensionPrice.amount,
        currency: offer.extensionPrice.currency,
      });
      if (!payload) return unavailable;

      const base = `ext:${fresh.id}:${offer.currentDeparture}`;
      const amended = await this.#write(context, fresh.id, `${base}:amend`, {
        operation: "amend-stay",
        payload,
      });
      if (!amended.ok) return { ok: false, reason: `amend_failed:${amended.code}` };
      const simulated = amended.simulated;
      const verify = !simulated || this.#verifySimulated === "check";

      const before = (await this.#reader.getBookedServices(fresh.id)) as ApaleoBookedService[];
      const mandatoryBefore = mandatoryServiceIds(before);
      const newNight = offer.currentDeparture;
      const { toExtend, alreadyExtended } = findExtendableServices({
        services: before,
        arrivalDate,
        oldDepartureDate: offer.currentDeparture,
        newDate: newNight,
      });
      const extras: {
        serviceId: string;
        extended: boolean;
        alreadyDone?: boolean;
        amount?: Money;
        error?: string;
      }[] = alreadyExtended.map((s) => ({
        serviceId: s.serviceId,
        extended: true,
        alreadyDone: true,
      }));
      for (const service of toExtend) {
        const dates = buildServiceExtensionDates({
          existingDates: service.existingDates,
          newDate: newNight,
          normalPricePerNight: service.normalPricePerNight,
        });
        const result = await this.#write(context, fresh.id, `${base}:svc:${service.serviceId}`, {
          operation: "book-service",
          serviceId: service.serviceId,
          count: Math.max(1, ...dates.map((d) => Number(d.count) || 1)),
          dates: dates.map((d) => ({
            serviceDate: d.serviceDate ?? newNight,
            count: d.count,
            amount: d.amount,
          })),
        });
        extras.push(
          result.ok
            ? { serviceId: service.serviceId, extended: true, amount: service.normalPricePerNight }
            : { serviceId: service.serviceId, extended: false, error: result.code },
        );
      }

      const moves: {
        serviceId: string;
        oldDeparture: string;
        newDeparture: string;
        amount: Money;
        count: number | undefined;
        moved: boolean;
        verified: boolean | null;
        error?: string;
      }[] = [];
      for (const candidate of findDepartureDateCandidates({
        services: before,
        oldDepartureDate: offer.currentDeparture,
      })) {
        const definition = await this.#reader
          .getServiceDefinition(candidate.serviceId)
          .catch(() => null);
        if (!isLateCheckoutMoveEligible(definition)) continue;
        const dates = buildLateCheckoutMoveDates({
          newDepartureDate: offer.newDeparture,
          count: candidate.count,
          amount: candidate.amount,
        });
        const result = await this.#write(context, fresh.id, `${base}:lco:${candidate.serviceId}`, {
          operation: "book-service",
          serviceId: candidate.serviceId,
          count: Math.max(1, Number(candidate.count) || 1),
          dates,
        });
        moves.push({
          serviceId: candidate.serviceId,
          oldDeparture: offer.currentDeparture,
          newDeparture: offer.newDeparture,
          amount: candidate.amount,
          count: candidate.count,
          moved: result.ok,
          verified: result.ok ? null : false,
          ...(result.ok ? {} : { error: result.code }),
        });
      }

      let newDepartureConfirmed = false;
      let cityTax: { applicable: boolean; verified: boolean | null; amount: Money | null } = {
        applicable: Boolean(fresh.hasCityTax),
        verified: null,
        amount: null,
      };
      let mandatoryIntact = true;
      if (verify) {
        const after = await this.#reader.getReservationForExtension(fresh.id);
        newDepartureConfirmed = getDepartureDate(after) === offer.newDeparture;
        if (fresh.hasCityTax) {
          const found = findCityTaxAmount(
            await this.#reader.listReservationFolios(fresh.id),
            newNight,
          );
          cityTax = { applicable: true, verified: Boolean(found), amount: found };
        }
        const servicesAfter = (await this.#reader.getBookedServices(
          fresh.id,
        )) as ApaleoBookedService[];
        const mandatoryAfter = mandatoryServiceIds(servicesAfter);
        mandatoryIntact = [...mandatoryBefore].every((id) => mandatoryAfter.has(id));
        for (const move of moves) {
          if (!move.moved) continue;
          move.verified = verifyLateCheckoutMove({
            services: servicesAfter,
            serviceId: move.serviceId,
            oldDepartureDate: move.oldDeparture,
            newDepartureDate: move.newDeparture,
            expectedAmount: move.amount.amount,
            expectedCount: move.count,
          });
        }
      }
      const ok =
        extras.every((e) => e.extended) &&
        moves.every((m) => m.moved && (m.verified || !verify)) &&
        (!verify ||
          (newDepartureConfirmed && (!cityTax.applicable || cityTax.verified) && mandatoryIntact));
      const status = ok ? "confirmed" : "confirmed_with_issues";
      const total = computeExtensionAdditionalTotal({
        extensionPrice: offer.extensionPrice,
        extras,
        cityTax,
      });
      await this.#records.addStayExtension({
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        externalReservationId: fresh.id,
        oldDeparture: offer.currentDeparture,
        newDeparture: offer.newDeparture,
        newDepartureConfirmed,
        phase: offer.phase === "in_house" ? "in_house" : "pre_arrival",
        gap: Math.min(offer.gap, 365),
        averageNightlyRateCents: cents(offer.averageNightlyRate),
        discountPercent: offer.discountPercent,
        extensionPriceCents: cents(offer.extensionPrice),
        totalAdditionalCents: cents(total),
        currency: offer.extensionPrice.currency,
        details: {
          extras,
          lateCheckoutMoves: moves,
          cityTax,
          simulated,
          verification: verify ? "checked" : "skipped_simulated",
        },
        mandatoryServicesIntact: mandatoryIntact,
        status,
        now: this.#now(),
      });
      return {
        ok: true,
        newDeparture: offer.newDeparture,
        extensionPrice: offer.extensionPrice,
        status,
        simulated,
      };
    } catch (error) {
      return { ok: false, reason: errorReason(error) };
    } finally {
      await this.#locks.release({ tenantId: context.tenantId, key: lockKey, holder });
    }
  }

  /* ── Helpers ─────────────────────────────────────────────────────────────────────────── */

  async #unitGroupOrNull(unitGroupId: string) {
    try {
      return await this.#reader.getUnitGroup(unitGroupId);
    } catch (error) {
      if (error instanceof PmsError && error.kind === "not-found") return null;
      throw error;
    }
  }

  #claim(context: EngineContext, key: string, holder: string) {
    return this.#locks.claim({
      tenantId: context.tenantId,
      key,
      holder,
      ttlMs: LOCK_TTL_MS,
      now: this.#now(),
    });
  }

  async #withLock<T>(context: EngineContext, key: string, run: () => Promise<T>): Promise<T> {
    const holder = this.#newId();
    if (!(await this.#claim(context, key, holder))) throw new EngineError("in_progress");
    try {
      return await run();
    } finally {
      await this.#locks.release({ tenantId: context.tenantId, key, holder });
    }
  }

  async #write(
    context: EngineContext,
    reservationId: string,
    idempotencyKey: string,
    command: ServiceWriteCommand,
    actorAdminId?: string | null,
  ): Promise<{ ok: true; simulated: boolean } | { ok: false; code: string }> {
    const request: ServiceWriteRequest = {
      tenantId: context.tenantId,
      propertyId: context.propertyId,
      apaleoPropertyId: context.apaleoPropertyId,
      reservationId,
      idempotencyKey,
      trigger: actorAdminId === undefined ? "guest" : "admin",
      actorAdminId: actorAdminId ?? null,
      command,
    };
    const outcome = await this.#gateway.execute(request);
    if (outcome.status === "simulated") return { ok: true, simulated: true };
    if (outcome.status === "succeeded") return { ok: true, simulated: false };
    if (outcome.status === "in_progress") return { ok: false, code: "in_progress" };
    if (outcome.status === "rejected") return { ok: false, code: outcome.code };
    return { ok: false, code: outcome.code };
  }

  async #mustWrite(
    context: EngineContext,
    reservationId: string,
    idempotencyKey: string,
    command: ServiceWriteCommand,
  ) {
    const result = await this.#write(context, reservationId, idempotencyKey, command);
    if (!result.ok) throw new EngineError(`booking_failed:${result.code}`);
  }
}
