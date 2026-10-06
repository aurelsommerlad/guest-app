/**
 * Guest journey (ADR 0016): where a guest stands in their stay – framework-free and
 * derived on every request, never stored.
 *
 * Three independent axes, deliberately kept apart:
 *  - time phase     – only reservation window, property time zone and "now"
 *  - registration   – process state of the online check-in (our canonical record)
 *  - access         – whether access information can be shown (see access-model.ts)
 *
 * The guest-facing primary action is a pure function of the three. Later automations
 * (reminders, door code release, check-out notes) hook into the same derived values
 * instead of their own date logic.
 */

export const JOURNEY_PHASES = [
  /** Before the local arrival date. */
  "before-arrival",
  /** The whole local arrival date (before and after the check-in time). */
  "arrival-day",
  /** Between arrival date and departure date. */
  "in-stay",
  /** The local departure date until the check-out time. */
  "departure-day",
  /** From the check-out time on. */
  "after-departure",
] as const;
export type JourneyPhase = (typeof JOURNEY_PHASES)[number];

export type JourneyWindow = {
  /** Check-in instant, ISO 8601 with offset. */
  checkInAt: string;
  /** Check-out instant, ISO 8601 with offset. */
  checkOutAt: string;
  /** IANA time zone of the property – local dates are the property's, not the guest's. */
  timeZone: string;
};

/** YYYY-MM-DD of an instant in a time zone. */
export function localDateOf(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function parseInstant(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid journey window instant");
  return date;
}

export function deriveJourneyPhase(window: JourneyWindow, now: Date): JourneyPhase {
  const checkIn = parseInstant(window.checkInAt);
  const checkOut = parseInstant(window.checkOutAt);
  if (checkOut.getTime() <= checkIn.getTime()) {
    throw new RangeError("Invalid journey window: check-out must be after check-in");
  }
  if (now.getTime() >= checkOut.getTime()) return "after-departure";
  const today = localDateOf(now, window.timeZone);
  const arrivalDate = localDateOf(checkIn, window.timeZone);
  const departureDate = localDateOf(checkOut, window.timeZone);
  if (today < arrivalDate) return "before-arrival";
  // A same-day stay counts as arrival day until check-in, then as departure day.
  if (today === arrivalDate && (today !== departureDate || now < checkIn)) return "arrival-day";
  if (today === departureDate) return "departure-day";
  return "in-stay";
}

/** Process state of the online check-in, independent of any provider sync. */
export const REGISTRATION_PROGRESS = [
  /** The property does not use online check-in. */
  "not-required",
  "not-started",
  "in-progress",
  /** Our canonical registration is complete – provider syncs run separately. */
  "completed",
] as const;
export type RegistrationProgress = (typeof REGISTRATION_PROGRESS)[number];

export type JourneyAccessState = "available" | "pending" | "manual";

export const JOURNEY_ACTIONS = [
  "online-check-in",
  "check-in-info",
  "show-access",
  "check-out",
  "none",
] as const;
export type JourneyAction = (typeof JOURNEY_ACTIONS)[number];

export type GuestJourney = {
  phase: JourneyPhase;
  registration: RegistrationProgress;
  access: JourneyAccessState;
  /** What the STAY screen puts first. */
  primaryAction: JourneyAction;
};

const REGISTRATION_OPEN_PHASES: readonly JourneyPhase[] = [
  "before-arrival",
  "arrival-day",
  "in-stay",
];

export function primaryActionFor(
  phase: JourneyPhase,
  registration: RegistrationProgress,
  access: JourneyAccessState,
): JourneyAction {
  if (phase === "after-departure") return "none";
  const registrationOpen = registration === "not-started" || registration === "in-progress";
  if (registrationOpen && REGISTRATION_OPEN_PHASES.includes(phase)) return "online-check-in";
  if (phase === "departure-day") return "check-out";
  if (phase === "before-arrival") return "check-in-info";
  if (access === "available") return "show-access";
  return phase === "arrival-day" ? "check-in-info" : "check-out";
}

export function deriveGuestJourney(input: {
  window: JourneyWindow;
  now: Date;
  registration: RegistrationProgress;
  access: JourneyAccessState;
}): GuestJourney {
  const phase = deriveJourneyPhase(input.window, input.now);
  return {
    phase,
    registration: input.registration,
    access: input.access,
    primaryAction: primaryActionFor(phase, input.registration, input.access),
  };
}
