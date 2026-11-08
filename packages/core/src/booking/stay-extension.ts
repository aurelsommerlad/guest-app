/**
 * "Eine Nacht länger" (stay extension) rules, ported 1:1 from the Extras app
 * (lib/stayExtension.js, lib/store.js getExtensionConfig). Pure functions; the Apaleo calls
 * around them live in the STAY booking gateway.
 */
import { type Money } from "../payment/payment-summary";
import {
  type ApaleoBookedService,
  type ApaleoReservationLike,
  getAdultsCount,
  round2,
  type TimeSliceLike,
} from "./service-rules";

/** Per-property settings (Extras key extension-night:config:{propertyId}). */
export type StayExtensionSettings = {
  extensionNightEnabled: boolean;
  extensionDiscountPreArrivalOneNightGap: number;
  extensionDiscountPreArrivalStandard: number;
  extensionDiscountInHouseOneNightGap: number;
  extensionDiscountInHouseStandard: number;
  minSellableStayNights: number;
};

export const DEFAULT_STAY_EXTENSION_SETTINGS: StayExtensionSettings = {
  extensionNightEnabled: false,
  extensionDiscountPreArrivalOneNightGap: 15,
  extensionDiscountPreArrivalStandard: 10,
  extensionDiscountInHouseOneNightGap: 20,
  extensionDiscountInHouseStandard: 15,
  minSellableStayNights: 2,
};

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reads a stored Extras config, including records written before the phase-specific
 * discounts existed: new field → legacy flat field (extensionDiscountOneNightGap /
 * extensionDiscountStandard) → default.
 */
export function resolveStayExtensionSettings(
  stored: Record<string, unknown> | null | undefined,
): StayExtensionSettings {
  const s = stored ?? {};
  const legacyOneNight = finite(s.extensionDiscountOneNightGap);
  const legacyStandard = finite(s.extensionDiscountStandard);
  const pick = (key: keyof StayExtensionSettings, legacy: number | null) =>
    finite(s[key]) ?? legacy ?? (DEFAULT_STAY_EXTENSION_SETTINGS[key] as number);
  return {
    extensionNightEnabled: s.extensionNightEnabled === true,
    extensionDiscountPreArrivalOneNightGap: pick(
      "extensionDiscountPreArrivalOneNightGap",
      legacyOneNight,
    ),
    extensionDiscountPreArrivalStandard: pick(
      "extensionDiscountPreArrivalStandard",
      legacyStandard,
    ),
    extensionDiscountInHouseOneNightGap: pick(
      "extensionDiscountInHouseOneNightGap",
      legacyOneNight,
    ),
    extensionDiscountInHouseStandard: pick("extensionDiscountInHouseStandard", legacyStandard),
    minSellableStayNights:
      finite(s.minSellableStayNights) ?? DEFAULT_STAY_EXTENSION_SETTINGS.minSellableStayNights,
  };
}

export function addOneDay(dateStr: unknown): string | null {
  if (typeof dateStr !== "string" || !dateStr) return null;
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Average of the accommodation time slices (services never included). */
export function computeAverageNightlyRate(
  timeSlices: readonly TimeSliceLike[] | null | undefined,
): number | null {
  if (!timeSlices?.length) return null;
  let sum = 0;
  for (const slice of timeSlices) {
    const amount = Number(slice.totalGrossAmount?.amount);
    if (!Number.isFinite(amount)) return null;
    sum += amount;
  }
  return round2(sum / timeSlices.length);
}

export type ExtensionDecision =
  | { offer: true; discountPercent: number; reason: "closes_gap" | "remaining_gap_sellable" }
  | {
      offer: false;
      reason: "invalid_gap" | "invalid_config" | "no_availability" | "would_leave_unsellable_gap";
    };

/** gap 1 → one-night discount; gap > min → standard; otherwise no offer. */
export function decideExtensionOffer(input: {
  gap: number;
  minSellableStayNights: unknown;
  discountOneNightGap: unknown;
  discountStandard: unknown;
}): ExtensionDecision {
  const min = Number(input.minSellableStayNights);
  const oneNight = Number(input.discountOneNightGap);
  const standard = Number(input.discountStandard);
  if (!Number.isInteger(input.gap) || input.gap < 0) return { offer: false, reason: "invalid_gap" };
  if (!Number.isFinite(min) || min < 1) return { offer: false, reason: "invalid_config" };
  if (!Number.isFinite(oneNight) || !Number.isFinite(standard))
    return { offer: false, reason: "invalid_config" };
  if (input.gap === 1) return { offer: true, discountPercent: oneNight, reason: "closes_gap" };
  if (input.gap > min)
    return { offer: true, discountPercent: standard, reason: "remaining_gap_sellable" };
  return {
    offer: false,
    reason: input.gap === 0 ? "no_availability" : "would_leave_unsellable_gap",
  };
}

export type ExtensionPhase = "before_arrival" | "in_house";

/** InHouse status, or arrival ≤ today < departure → in_house. */
export function determineStayExtensionPhase(input: {
  status?: string;
  arrivalDate?: string | null;
  departureDate?: string | null;
  today: Date;
}): ExtensionPhase {
  if (input.status === "InHouse") return "in_house";
  const today = input.today.toISOString().slice(0, 10);
  const arrival = input.arrivalDate ? input.arrivalDate.slice(0, 10) : null;
  const departure = input.departureDate ? input.departureDate.slice(0, 10) : null;
  return arrival && departure && arrival <= today && departure > today
    ? "in_house"
    : "before_arrival";
}

export function buildExtensionOffer(input: {
  reservation: ApaleoReservationLike & { departure?: unknown };
  timeSlices: readonly TimeSliceLike[];
  gap: number;
  config: StayExtensionSettings;
  phase: ExtensionPhase;
}) {
  const inHouse = input.phase === "in_house";
  const decision = decideExtensionOffer({
    gap: input.gap,
    minSellableStayNights: input.config.minSellableStayNights,
    discountOneNightGap: inHouse
      ? input.config.extensionDiscountInHouseOneNightGap
      : input.config.extensionDiscountPreArrivalOneNightGap,
    discountStandard: inHouse
      ? input.config.extensionDiscountInHouseStandard
      : input.config.extensionDiscountPreArrivalStandard,
  });
  if (!decision.offer) return null;
  const average = computeAverageNightlyRate(input.timeSlices);
  if (average === null) return null;
  const departure = input.reservation.departure;
  const currentDeparture =
    typeof departure === "string" && departure ? departure.slice(0, 10) : null;
  const newDeparture = addOneDay(departure);
  if (!currentDeparture || !newDeparture) return null;
  const currency = input.timeSlices[0]?.totalGrossAmount?.currency || "EUR";
  return {
    currentDeparture,
    newDeparture,
    averageNightlyRate: { amount: average, currency },
    extensionPrice: { amount: round2(average * (1 - decision.discountPercent / 100)), currency },
    discountPercent: decision.discountPercent,
    gap: input.gap,
    phase: input.phase,
  };
}

function nightsBetween(
  arrival: string | null | undefined,
  departure: string | null | undefined,
): string[] {
  if (!arrival || !departure) return [];
  const nights: string[] = [];
  const cursor = new Date(`${arrival.slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${departure.slice(0, 10)}T00:00:00Z`);
  while (cursor < end) {
    nights.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return nights;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

export type ExtendableService = {
  serviceId: string;
  name: unknown;
  normalPricePerNight: Money;
  existingDates: { serviceDate: string | undefined; count: number | undefined; amount: Money }[];
};

/**
 * Non-mandatory services covering exactly the original nights get the new night appended;
 * ones already covering the extended set are "already extended" (idempotent retry).
 */
export function findExtendableServices(input: {
  services: readonly ApaleoBookedService[] | null | undefined;
  arrivalDate: string | null;
  oldDepartureDate: string | null;
  newDate: string;
}) {
  const original = new Set(nightsBetween(input.arrivalDate, input.oldDepartureDate));
  const extended = new Set([...original, input.newDate]);
  const toExtend: ExtendableService[] = [];
  const alreadyExtended: ExtendableService[] = [];
  for (const entry of input.services ?? []) {
    const dates = Array.isArray(entry.dates) ? entry.dates : [];
    if (!dates.length || dates.some((d) => d.isMandatory)) continue;
    const set = new Set(dates.map((d) => d.serviceDate ?? ""));
    const matchesOriginal = sameSet(set, original);
    const matchesExtended = sameSet(set, extended);
    if (!matchesOriginal && !matchesExtended) continue;
    const serviceId = entry.service?.id;
    if (!serviceId) continue;
    const sorted = [...dates].sort((a, b) =>
      String(a.serviceDate).localeCompare(String(b.serviceDate)),
    );
    const last = sorted[sorted.length - 1];
    const normal = {
      amount: Number(last?.amount?.grossAmount),
      currency: last?.amount?.currency || "EUR",
    };
    if (!Number.isFinite(normal.amount)) continue;
    const item: ExtendableService = {
      serviceId,
      name: entry.service?.name ?? entry.service?.code ?? serviceId,
      normalPricePerNight: normal,
      existingDates: dates.map((d) => ({
        serviceDate: d.serviceDate,
        count: d.count,
        amount: { amount: Number(d.amount?.grossAmount), currency: d.amount?.currency || "EUR" },
      })),
    };
    (matchesExtended ? alreadyExtended : toExtend).push(item);
  }
  return { toExtend, alreadyExtended };
}

export function buildServiceExtensionDates(input: {
  existingDates: ExtendableService["existingDates"];
  newDate: string;
  normalPricePerNight: Money;
}) {
  const lastCount = input.existingDates[input.existingDates.length - 1]?.count ?? 1;
  return [
    ...input.existingDates.map((d) => ({
      serviceDate: d.serviceDate,
      count: d.count,
      amount: d.amount,
    })),
    { serviceDate: input.newDate, count: lastCount, amount: input.normalPricePerNight },
  ];
}

/** Single-date, non-mandatory services on the old departure (Late-Check-out candidates). */
export function findDepartureDateCandidates(input: {
  services: readonly ApaleoBookedService[] | null | undefined;
  oldDepartureDate: string;
}) {
  const candidates: {
    serviceId: string;
    name: unknown;
    count: number | undefined;
    amount: Money;
  }[] = [];
  for (const entry of input.services ?? []) {
    const dates = Array.isArray(entry.dates) ? entry.dates : [];
    const [only] = dates;
    if (
      dates.length !== 1 ||
      !only ||
      only.isMandatory ||
      only.serviceDate !== input.oldDepartureDate
    )
      continue;
    const serviceId = entry.service?.id;
    if (!serviceId) continue;
    const amount = Number(only.amount?.grossAmount);
    if (!Number.isFinite(amount)) continue;
    candidates.push({
      serviceId,
      name: entry.service?.name ?? entry.service?.code ?? serviceId,
      count: only.count,
      amount: { amount, currency: only.amount?.currency || "EUR" },
    });
  }
  return candidates;
}

/** A candidate moves only if Apaleo defines it as Departure + postNextDay. */
export function isLateCheckoutMoveEligible(
  definition: { availability?: { mode?: string }; postNextDay?: boolean } | null | undefined,
): boolean {
  return definition?.availability?.mode === "Departure" && definition.postNextDay === true;
}

export function buildLateCheckoutMoveDates(input: {
  newDepartureDate: string;
  count: number | undefined;
  amount: Money;
}) {
  return [{ serviceDate: input.newDepartureDate, count: input.count, amount: input.amount }];
}

export function verifyLateCheckoutMove(input: {
  services: readonly ApaleoBookedService[] | null | undefined;
  serviceId: string;
  oldDepartureDate: string;
  newDepartureDate: string;
  expectedAmount: unknown;
  expectedCount: number | undefined;
}): boolean {
  const entry = (input.services ?? []).find((s) => s.service?.id === input.serviceId);
  const dates = Array.isArray(entry?.dates) ? entry.dates : [];
  const [date] = dates;
  if (dates.length !== 1 || !date) return false;
  if (date.serviceDate !== input.newDepartureDate || date.serviceDate === input.oldDepartureDate)
    return false;
  if (Number(date.count) !== Number(input.expectedCount)) return false;
  return Number(date.amount?.grossAmount) === Number(input.expectedAmount);
}

export type FolioLike = {
  charges?: {
    type?: string;
    serviceDate?: string;
    amount?: { grossAmount?: number; currency?: string };
  }[];
};

/** City tax only ever from the posted folio charge – never computed from configuration. */
export function findCityTaxAmount(
  folios: readonly FolioLike[] | null | undefined,
  serviceDate: string,
): Money | null {
  for (const folio of folios ?? []) {
    for (const charge of folio.charges ?? []) {
      if (charge.type !== "CityTax" || charge.serviceDate !== serviceDate) continue;
      const amount = Number(charge.amount?.grossAmount);
      if (!Number.isFinite(amount)) continue;
      return { amount, currency: charge.amount?.currency || "EUR" };
    }
  }
  return null;
}

export function buildExtensionPricePreview(input: {
  extensionPrice: Money | null | undefined;
  extras: readonly { amount?: { amount?: number } | Money }[] | null | undefined;
  cityTax: Money | null | undefined;
}): Money {
  let total = Number(input.extensionPrice?.amount) || 0;
  for (const extra of input.extras ?? []) total += Number(extra.amount?.amount) || 0;
  if (input.cityTax) total += input.cityTax.amount || 0;
  return { amount: round2(total), currency: input.extensionPrice?.currency || "EUR" };
}

/** Completed-extension total; null rather than a guess when data is missing or unverified. */
export function computeExtensionAdditionalTotal(input: {
  extensionPrice: Money | null | undefined;
  extras?:
    readonly { extended?: boolean; alreadyDone?: boolean; amount?: { amount?: number } }[] | null;
  cityTax?: {
    applicable?: boolean;
    verified?: boolean | null;
    amount?: { amount?: number } | null;
  } | null;
}): Money | null {
  const base = Number(input.extensionPrice?.amount);
  if (!input.extensionPrice || !Number.isFinite(base)) return null;
  let amount = base;
  for (const extra of input.extras ?? []) {
    if (!extra.extended || extra.alreadyDone) continue;
    const value = Number(extra.amount?.amount);
    if (!Number.isFinite(value)) return null;
    amount += value;
  }
  if (input.cityTax?.applicable) {
    const value = Number(input.cityTax.amount?.amount);
    if (!input.cityTax.verified || !Number.isFinite(value)) return null;
    amount += value;
  }
  return { amount: round2(amount), currency: input.extensionPrice.currency || "EUR" };
}

/** AmendReservation body: one more night at the given price, existing slices unchanged. */
export function buildStayExtensionAmendmentPayload(input: {
  reservation: ApaleoReservationLike & { arrival?: unknown; departure?: unknown };
  timeSlices: readonly TimeSliceLike[] | null | undefined;
  extensionPrice: unknown;
  currency?: string;
}) {
  const currency = input.currency || "EUR";
  const price = Number(input.extensionPrice);
  if (!Number.isFinite(price) || price < 0) return null;
  if (!input.reservation.arrival || !input.reservation.departure) return null;
  if (!input.timeSlices?.length) return null;
  const next = [];
  for (const slice of input.timeSlices) {
    const ratePlanId = slice.ratePlan?.id;
    const amount = Number(slice.totalGrossAmount?.amount);
    if (!ratePlanId || !Number.isFinite(amount)) return null;
    next.push({
      ratePlanId,
      totalGrossAmount: { amount, currency: slice.totalGrossAmount?.currency ?? currency },
    });
  }
  const lastRatePlan = input.timeSlices[input.timeSlices.length - 1]?.ratePlan?.id;
  if (!lastRatePlan) return null;
  next.push({ ratePlanId: lastRatePlan, totalGrossAmount: { amount: round2(price), currency } });
  const newDeparture = addOneDay(input.reservation.departure);
  if (!newDeparture) return null;
  return {
    arrival: input.reservation.arrival,
    departure: newDeparture,
    adults: getAdultsCount(input.reservation),
    childrenAges: Array.isArray(input.reservation.childrenAges)
      ? input.reservation.childrenAges
      : null,
    timeSlices: next,
    requote: false,
  };
}
