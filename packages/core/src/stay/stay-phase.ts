/**
 * Phase of a guest's stay, derived from the reservation – never stored.
 *
 *  pre-arrival      → before the check-in time on the arrival day
 *  in-house         → from check-in until check-out on the departure day
 *  post-departure   → after the check-out time
 */
export type StayPhase = "pre-arrival" | "in-house" | "post-departure";

export type StayWindow = {
  /** Check-in instant (ISO 8601 with offset, e.g. "2026-08-27T15:00:00+02:00"). */
  checkInAt: string;
  /** Check-out instant (ISO 8601 with offset). */
  checkOutAt: string;
};

export function deriveStayPhase(window: StayWindow, now: Date): StayPhase {
  const checkIn = Date.parse(window.checkInAt);
  const checkOut = Date.parse(window.checkOutAt);
  if (Number.isNaN(checkIn) || Number.isNaN(checkOut)) {
    throw new RangeError("Invalid stay window: check-in and check-out must be ISO 8601 instants");
  }
  if (checkOut <= checkIn) {
    throw new RangeError("Invalid stay window: check-out must be after check-in");
  }
  const t = now.getTime();
  if (t < checkIn) return "pre-arrival";
  if (t < checkOut) return "in-house";
  return "post-departure";
}
