/**
 * Whether an offer may be shown to a stay right now (pure, timezone-free: the caller passes
 * the property-local "today" and the local arrival date).
 */
import { type JourneyPhase } from "../journey/guest-journey";
import { isValidIsoDate } from "../registration/dates";
import { type OfferAvailability } from "./offer-model";

export type StayFacts = {
  phase: JourneyPhase;
  /** Property-local date (YYYY-MM-DD). */
  today: string;
  /** Property-local arrival date (YYYY-MM-DD). */
  arrivalDate: string;
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function inSeason(today: string, season: { from: string; to: string }): boolean {
  const md = today.slice(5);
  return season.from <= season.to
    ? md >= season.from && md <= season.to
    : md >= season.from || md <= season.to;
}

function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function isOfferAvailable(availability: OfferAvailability, stay: StayFacts): boolean {
  if (!isValidIsoDate(stay.today) || !isValidIsoDate(stay.arrivalDate)) return false;
  if (stay.phase === "after-departure" && !availability.phases.includes("after-departure")) {
    return false;
  }
  if (availability.phases.length > 0 && !availability.phases.includes(stay.phase)) return false;
  if (
    availability.seasons.length > 0 &&
    !availability.seasons.some((season) => inSeason(stay.today, season))
  ) {
    return false;
  }
  if (availability.weekdays.length > 0 && !availability.weekdays.includes(isoWeekday(stay.today))) {
    return false;
  }
  if (
    availability.showFromDaysBeforeArrival !== undefined &&
    stay.phase === "before-arrival" &&
    daysBetween(stay.today, stay.arrivalDate) > availability.showFromDaysBeforeArrival
  ) {
    return false;
  }
  return true;
}
