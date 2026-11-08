/**
 * Booking rules for own services, ported 1:1 from the Extras app (aurelsommerlad/guest-services,
 * lib/guest.js, lib/apaleo.js, lib/capacity.js, lib/occupancy.js, lib/unitGroupRestriction.js,
 * lib/dogBooking.js, lib/vehicleRegistration.js, lib/priceDisplay.js, lib/catalogLocalization.js,
 * lib/catalogSort.js, lib/occupancyAmendment.js, lib/requestApproval.js). Pure functions only –
 * no I/O – so the Extras tests can be mirrored one by one (service-rules.test.ts).
 *
 * Amounts stay in currency units (e.g. 15.5 EUR) exactly as in Extras and as Apaleo returns
 * them; conversion to cents happens at the edges.
 */

import { type Money } from "../payment/payment-summary";

/* ── Configuration vocabulary (Extras catalog fields) ─────────────────────────────────── */

/** Which Apaleo service date(s) a service resolves to for a reservation. */
export const BOOKING_RULES = ["per_stay", "per_night", "arrival_day", "departure_day"] as const;
export type BookingRule = (typeof BOOKING_RULES)[number];
export const DEFAULT_BOOKING_RULE: BookingRule = "per_stay";

/** `service`: book an Apaleo service · `increase_occupancy`: amend the reservation's adults. */
export const SERVICE_ACTION_TYPES = ["service", "increase_occupancy"] as const;
export type ServiceActionType = (typeof SERVICE_ACTION_TYPES)[number];

/** Instant booking or staff approval ("Auf Anfrage"). */
export const SERVICE_FULFILLMENT_MODES = ["instant", "request"] as const;
export type ServiceFulfillmentMode = (typeof SERVICE_FULFILLMENT_MODES)[number];


/** Minimal shapes of the Apaleo payloads the rules read (only the fields they use). */
export type ApaleoReservationLike = {
  id?: string;
  arrival?: string | { date?: string } | null;
  departure?: string | { date?: string } | null;
  checkInDate?: string;
  checkOutDate?: string;
  adults?: number;
  childrenAges?: number[] | null;
  status?: string;
  unitGroup?: { id?: string } | null;
  unit?: { id?: string; unitGroupId?: string } | null;
};

export type ApaleoOfferDate = {
  serviceDate: string;
  amount?: { grossAmount?: number; currency?: string };
  isDefaultDate?: boolean;
  availableCount?: number;
};

export type ApaleoServiceOffer = {
  service?: { id?: string };
  dates?: ApaleoOfferDate[];
  totalAmount?: { grossAmount?: number; currency?: string };
  availableCount?: number;
};

export type ApaleoBookedService = {
  service?: { id?: string; name?: unknown; code?: string };
  dates?: {
    serviceDate?: string;
    count?: number;
    amount?: { grossAmount?: number; currency?: string };
    isMandatory?: boolean;
  }[];
  isMandatory?: boolean;
};

/* ── Dates ─────────────────────────────────────────────────────────────────────────────── */

function datePart(value: unknown): string | null {
  if (typeof value === "string") return value ? value.slice(0, 10) : null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  return null;
}

/** YYYY-MM-DD departure date, tolerant of the shapes Apaleo has used. */
export function getDepartureDate(reservation: ApaleoReservationLike | null | undefined): string | null {
  const raw =
    (typeof reservation?.departure === "object" ? reservation.departure?.date : reservation?.departure) ??
    reservation?.checkOutDate ??
    null;
  return datePart(raw);
}

export function getArrivalDate(reservation: ApaleoReservationLike | null | undefined): string | null {
  const raw =
    (typeof reservation?.arrival === "object" ? reservation.arrival?.date : reservation?.arrival) ??
    reservation?.checkInDate ??
    null;
  return datePart(raw);
}

/** A date before today's UTC date (Extras' "past stay"). */
export function isPastDate(dateStr: string | null | undefined, today: Date): boolean {
  if (!dateStr) return false;
  return dateStr < today.toISOString().slice(0, 10);
}

/** Every night of a stay: arrival inclusive, departure exclusive. */
export function enumerateNights(arrivalDate: string | null, departureDate: string | null): string[] {
  if (!arrivalDate || !departureDate) return [];
  const nights: string[] = [];
  const cursor = new Date(`${arrivalDate.slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${departureDate.slice(0, 10)}T00:00:00Z`);
  while (cursor < end) {
    nights.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return nights;
}

/** Earliest default date of an offer (falls back to the earliest date at all). */
export function findDefaultServiceDate(offer: ApaleoServiceOffer | undefined): string | null {
  const dates = offer?.dates ?? [];
  if (!dates.length) return null;
  const defaults = dates.filter((d) => d.isDefaultDate);
  const pool = defaults.length ? defaults : dates;
  const sorted = [...pool].sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
  return sorted[0]?.serviceDate ?? null;
}

/**
 * The service dates a booking rule requires, restricted to dates the live service-offers
 * response returned. `complete` is false whenever a required date is missing – the whole item
 * is refused then, never a partial set of nights.
 */
export function resolveRequiredDates(
  bookingRule: string | undefined,
  offer: ApaleoServiceOffer | undefined,
  reservation: ApaleoReservationLike,
): { dates: string[]; complete: boolean } {
  const available = new Set((offer?.dates ?? []).map((d) => d.serviceDate));
  let required: string[];
  switch (bookingRule) {
    case "per_night":
      required = enumerateNights(getArrivalDate(reservation), getDepartureDate(reservation));
      break;
    case "arrival_day": {
      const arrival = getArrivalDate(reservation);
      required = arrival ? [arrival] : [];
      break;
    }
    case "departure_day": {
      const departure = getDepartureDate(reservation);
      required = departure ? [departure] : [];
      break;
    }
    default: {
      const defaultDate = findDefaultServiceDate(offer);
      required = defaultDate ? [defaultDate] : [];
    }
  }
  const dates = required.filter((d) => available.has(d));
  return { dates, complete: required.length > 0 && dates.length === required.length };
}

/** Gross price of the selected date, falling back to the offer's total amount. */
export function extractOfferPrice(offer: ApaleoServiceOffer | undefined, serviceDate: string | undefined): Money | null {
  const entry = (offer?.dates ?? []).find((d) => d.serviceDate === serviceDate);
  const amount = entry?.amount?.grossAmount ?? offer?.totalAmount?.grossAmount ?? null;
  if (amount === null) return null;
  const currency = entry?.amount?.currency || offer?.totalAmount?.currency || "EUR";
  return { amount, currency };
}

export function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Price for ONE count: unit price × nights (nights = date count for per_night, else 1). */
export function priceForItem(unitPrice: Money | null, bookingRule: string, dateCount: number) {
  const nights = bookingRule === "per_night" ? dateCount : 1;
  return {
    nights,
    price: unitPrice ? { amount: round2(unitPrice.amount * nights), currency: unitPrice.currency } : null,
  };
}

/* ── Occupancy, capacity, apartment types ─────────────────────────────────────────────── */

export function getAdultsCount(reservation: ApaleoReservationLike | null | undefined): number {
  return Number(reservation?.adults) || 0;
}

export function getChildrenCount(reservation: ApaleoReservationLike | null | undefined): number {
  return Array.isArray(reservation?.childrenAges) ? reservation.childrenAges.length : 0;
}

/** Children count as full persons, like Apaleo's own occupancy. */
export function getTotalOccupancy(reservation: ApaleoReservationLike | null | undefined): number {
  return getAdultsCount(reservation) + getChildrenCount(reservation);
}

export function getUnitGroupMaxOccupancy(unitGroup: { maxPersons?: unknown } | null | undefined): number | null {
  return typeof unitGroup?.maxPersons === "number" && Number.isFinite(unitGroup.maxPersons)
    ? unitGroup.maxPersons
    : null;
}

/** maxPersons − occupancy, never negative; unknown maxPersons → 0 (fail closed). */
export function getRemainingCapacity(
  unitGroup: { maxPersons?: unknown } | null | undefined,
  reservation: ApaleoReservationLike,
): number {
  const max = getUnitGroupMaxOccupancy(unitGroup);
  if (max === null) return 0;
  const remaining = max - getTotalOccupancy(reservation);
  return remaining > 0 ? remaining : 0;
}

export function getReservationUnitGroupId(reservation: ApaleoReservationLike | null | undefined): string | null {
  return reservation?.unitGroup?.id || reservation?.unit?.unitGroupId || null;
}

/** Empty list = unrestricted; unknown unit group against a restriction = not allowed. */
export function isUnitGroupAllowed(
  allowedUnitGroupIds: readonly string[] | null | undefined,
  unitGroupId: string | null | undefined,
): boolean {
  if (!Array.isArray(allowedUnitGroupIds) || allowedUnitGroupIds.length === 0) return true;
  return typeof unitGroupId === "string" && allowedUnitGroupIds.includes(unitGroupId);
}

/* ── Max one per reservation (dog) ───────────────────────────────────────────────────── */

/** Booked quantity of a service: `count` of ONE date entry, never the number of dates. */
export function countBookedServiceQuantity(services: readonly ApaleoBookedService[] | null | undefined, serviceId: string): number {
  const entry = (services ?? []).find((s) => s.service?.id === serviceId);
  const dates = entry?.dates;
  if (!Array.isArray(dates) || !dates.length) return 0;
  const count = Number(dates[0]?.count);
  return Number.isFinite(count) ? count : 0;
}

export const MAX_DOGS_PER_RESERVATION = 1;

export function hasReachedDogLimit(services: readonly ApaleoBookedService[] | null | undefined, serviceId: string): boolean {
  return countBookedServiceQuantity(services, serviceId) >= MAX_DOGS_PER_RESERVATION;
}

/* ── Vehicle registration (parking) ──────────────────────────────────────────────────── */

export const DEFAULT_VEHICLE_COUNTRY_CODE = "DE";

export function hasCompleteVehiclePlates(plates: readonly unknown[] | null | undefined, count: number): boolean {
  if (!(count > 0)) return true;
  const list: readonly unknown[] = plates ?? [];
  for (let i = 0; i < count; i++) {
    const value = list[i];
    if (typeof value !== "string" || !value.trim()) return false;
  }
  return true;
}

/** Exactly `count` trimmed plates, or null if incomplete (extra entries are ignored). */
export function normalizeVehiclePlates(plates: readonly unknown[] | null | undefined, count: number): string[] | null {
  if (!hasCompleteVehiclePlates(plates, count)) return null;
  const list = plates ?? [];
  return Array.from({ length: count }, (_, i) => String(list[i]).trim());
}

export function buildPrimaryVehicleRegistration(
  plates: readonly string[] | null | undefined,
  countryCode = DEFAULT_VEHICLE_COUNTRY_CODE,
) {
  const first = plates?.[0];
  return first ? { number: first, countryCode } : null;
}

/** Apaleo has one vehicle field – further plates go into a structured comment. */
export function formatVehiclePlatesComment(plates: readonly string[] | null | undefined): string | null {
  if (!plates || plates.length < 2) return null;
  return `Parking vehicles:\n${plates.map((p, i) => `${String(i + 1)}. ${p}`).join("\n")}`;
}

/* ── Presentation: price unit labels, localization, sort order ───────────────────────── */

type LabelRule = BookingRule | "per_person_per_night";

export const DEFAULT_PRICE_UNIT_LABELS: Record<"de" | "en", Record<LabelRule, string>> = {
  de: {
    per_night: "pro Nacht",
    per_stay: "pro Aufenthalt",
    arrival_day: "einmalig",
    departure_day: "einmalig",
    per_person_per_night: "pro Person / Nacht",
  },
  en: {
    per_night: "per night",
    per_stay: "per stay",
    arrival_day: "one-time",
    departure_day: "one-time",
    per_person_per_night: "per person / night",
  },
};

/** The admin's text if set, otherwise the default for the booking rule. */
export function resolvePriceUnitLabel(bookingRule: string, priceUnitLabel: unknown, language: "de" | "en" = "de"): string {
  const trimmed = typeof priceUnitLabel === "string" ? priceUnitLabel.trim() : "";
  if (trimmed) return trimmed;
  const table = DEFAULT_PRICE_UNIT_LABELS[language];
  return (table as Record<string, string>)[bookingRule] ?? "";
}

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** override → same-language Apaleo → other-language Apaleo → generic → final fallback. */
export function resolveBilingualText(input: {
  overrideDe?: unknown;
  overrideEn?: unknown;
  apaleoDe?: unknown;
  apaleoEn?: unknown;
  genericFallback?: unknown;
  finalFallback?: string;
}): { de: string; en: string } {
  const pick = (lang: "de" | "en") =>
    trim(lang === "de" ? input.overrideDe : input.overrideEn) ||
    trim(lang === "de" ? input.apaleoDe : input.apaleoEn) ||
    trim(lang === "de" ? input.apaleoEn : input.apaleoDe) ||
    trim(input.genericFallback) ||
    input.finalFallback ||
    "";
  return { de: pick("de"), en: pick("en") };
}

export function resolveBilingualPriceUnitLabel(input: {
  overrideDe?: unknown;
  overrideEn?: unknown;
  genericPriceUnitLabel?: unknown;
  bookingRule: string;
}): { de: string; en: string } {
  const pick = (lang: "de" | "en") =>
    trim(lang === "de" ? input.overrideDe : input.overrideEn) ||
    resolvePriceUnitLabel(input.bookingRule, input.genericPriceUnitLabel, lang);
  return { de: pick("de"), en: pick("en") };
}

/** Ascending sort order; missing values last (stable with Array.prototype.sort). */
export function compareBySortOrder(a: { sortOrder?: number | null }, b: { sortOrder?: number | null }): number {
  const aOrder = typeof a.sortOrder === "number" && Number.isFinite(a.sortOrder) ? a.sortOrder : Infinity;
  const bOrder = typeof b.sortOrder === "number" && Number.isFinite(b.sortOrder) ? b.sortOrder : Infinity;
  return aOrder === bOrder ? 0 : aOrder - bOrder;
}

/** "unit × nights × count = total" for the selected quantity (null if nothing to break down). */
export function computePriceBreakdown(input: { unitPrice: Money | null; nights: number; price: Money | null; count: number }) {
  const { unitPrice, nights, price, count } = input;
  if (!(count >= 1) || !(nights > 1 || count > 1) || !price) return null;
  const total = count > 1 ? { amount: round2(price.amount * count), currency: price.currency } : price;
  return { unitPrice, nights: nights > 1 ? nights : null, count: count > 1 ? count : null, total };
}

/* ── Additional guests (increase_occupancy) ──────────────────────────────────────────── */

export function buildExtraPersonPricing(input: { pricePerNight: unknown; nights: number; currency?: string }) {
  const price = Number(input.pricePerNight);
  const currency = input.currency || "EUR";
  if (input.pricePerNight === null || input.pricePerNight === undefined || input.pricePerNight === "") return null;
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(input.nights) || input.nights <= 0) return null;
  return {
    unitPrice: { amount: price, currency },
    nights: input.nights,
    price: { amount: round2(price * input.nights), currency },
  };
}

export type TimeSliceLike = {
  ratePlan?: { id?: string };
  totalGrossAmount?: { amount?: number; currency?: string };
};

type ReservationForAmend = ApaleoReservationLike & { arrival?: unknown; departure?: unknown };

/** AmendReservation body: adults + n, every slice resent with the surcharge added, requote:false. */
export function buildOccupancyAmendmentPayload(input: {
  reservation: ReservationForAmend;
  timeSlices: readonly TimeSliceLike[] | null | undefined;
  /** Untyped at runtime (stored config / form data) – coerced like in Extras. */
  extraPersonPricePerNight: unknown;
  additionalPersonCount: unknown;
}) {
  const price = Number(input.extraPersonPricePerNight);
  const count = Number(input.additionalPersonCount);
  if (!Number.isFinite(price) || price < 0) return null;
  if (!Number.isInteger(count) || count <= 0) return null;
  if (!input.reservation.arrival || !input.reservation.departure) return null;
  const timeSlices = input.timeSlices ?? [];
  if (!timeSlices.length) return null;
  const nextTimeSlices = [];
  for (const slice of timeSlices) {
    const ratePlanId = slice.ratePlan?.id;
    const currentAmount = Number(slice.totalGrossAmount?.amount);
    if (!ratePlanId || !Number.isFinite(currentAmount)) return null;
    nextTimeSlices.push({
      ratePlanId,
      totalGrossAmount: {
        amount: round2(currentAmount + price * count),
        currency: slice.totalGrossAmount?.currency || "EUR",
      },
    });
  }
  return {
    arrival: input.reservation.arrival,
    departure: input.reservation.departure,
    adults: getAdultsCount(input.reservation) + count,
    childrenAges: Array.isArray(input.reservation.childrenAges) ? input.reservation.childrenAges : null,
    timeSlices: nextTimeSlices,
    requote: false,
  };
}

/* ── Request approval ────────────────────────────────────────────────────────────────── */

/**
 * Existing Apaleo booking vs. what an approval would book: "none" → book; "complete" →
 * nothing to book (idempotent); "conflict" → never book (book-service replaces date sets).
 */
export function compareExistingBooking(
  services: readonly ApaleoBookedService[] | null | undefined,
  serviceId: string,
  requiredDates: readonly string[],
  count: number,
): "none" | "complete" | "conflict" {
  const entry = (services ?? []).find((s) => s.service?.id === serviceId);
  const dates = Array.isArray(entry?.dates) ? entry.dates : [];
  if (!dates.length) return "none";
  const byDate = new Map(dates.map((d) => [d.serviceDate, Number(d.count) || 0]));
  return requiredDates.every((date) => (byDate.get(date) ?? 0) >= count) ? "complete" : "conflict";
}

/** Dates on which the live offer has fewer units than requested (unknown = enough). */
export function datesWithoutAvailability(
  offer: ApaleoServiceOffer | undefined,
  dates: readonly string[],
  quantity: number,
): string[] {
  return dates.filter((date) => {
    const entry = (offer?.dates ?? []).find((d) => d.serviceDate === date);
    const available = entry?.availableCount ?? offer?.availableCount ?? null;
    return available !== null && available < quantity;
  });
}
