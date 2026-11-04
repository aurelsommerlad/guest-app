import {
  CHECK_IN_STEPS,
  deriveStayPhase,
  type GuestJourney,
  type JourneyPhase,
  type LocalizedText,
  type RegistrationAssessment,
  resolveLocalizedText,
  type StayAccess,
} from "@up/core";

import { type Locale, routing } from "../../i18n/routing";
import {
  type AccentTileView,
  type CheckInCardView,
  type LocalTime,
  type StartTileView,
  type StayAccessView,
  type StayPaymentInput,
  type StaySource,
  type StayStatus,
  type StayViewModel,
} from "./model";

/** Journey data STAY needs (from features/journey). */
export type StayJourneyInput = {
  journey: GuestJourney;
  assessment: Pick<RegistrationAssessment, "stepsRemaining"> &
    Partial<Pick<RegistrationAssessment, "steps">>;
  access: StayAccess;
  /** Official guest registration (e.g. Feratel) – only if the property reports to one. */
  guestRegistration?: "pending" | "submitted";
  /** Submitted check-in whose person count no longer matches the reservation. */
  occupancyChanged?: boolean;
  /** From the payment module (ADR 0018) – not wired yet, so STAY makes no payment statement. */
  payment?: StayPaymentInput;
};

/** Anchor of the access panel on the STAY screen. */
export const ACCESS_HREF = "#stay-access";

export const CHECK_IN_HREF = "/check-in";

/**
 * Turns stay source data (and, when available, the guest journey) into the screen's view
 * model: picks the primary tile, the access panel, formats dates in the property's time
 * zone and resolves translated content. Pure – `now` is injected.
 */
export function buildStayViewModel(
  source: StaySource,
  locale: Locale,
  now: Date,
  journey?: StayJourneyInput,
): StayViewModel {
  const { reservation, property } = source;
  const phase = deriveStayPhase(reservation, now);
  const text = (value: LocalizedText) => resolveLocalizedText(value, locale, routing.defaultLocale);
  const localTime = (iso: string): LocalTime => {
    const instant = new Date(iso);
    const timeZone = property.timeZone;
    return {
      time: new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone }).format(instant),
      date: new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone }).format(instant),
      dateTime: iso,
    };
  };

  const access = journey ? selectAccess(journey, localTime, text) : undefined;
  const status = selectStatus(source, now, localTime, journey);
  const upcoming = journey?.journey.phase === "before-arrival";
  const checkIn = journey ? selectCheckIn(journey) : undefined;
  const preview =
    upcoming && journey.access.status === "pending" && journey.access.releasesAt
      ? {
          ...localTime(journey.access.releasesAt),
          withTime: Date.parse(journey.access.releasesAt) === Date.parse(reservation.checkInAt),
        }
      : undefined;
  const [firstCard] = source.cards;
  const unit = { name: source.unit.name, href: "/guide" };
  const timeTile: Extract<StayStatus, { kind: "check-in" | "check-out" }> =
    status.kind === "online-check-in"
      ? phase === "pre-arrival"
        ? { kind: "check-in", ...localTime(reservation.checkInAt) }
        : {
            kind: "check-out",
            today: journey?.journey.phase === "departure-day",
            ...localTime(reservation.checkOutAt),
          }
      : status;
  // Without the year: the stay tile is shown before an upcoming stay only, and the light,
  // large statement must fit a half-width tile on one line ("27.–31. Aug.").
  const shortRange = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: property.timeZone,
  }).formatRange(new Date(reservation.checkInAt), new Date(reservation.checkOutAt));
  return {
    locale,
    phase,
    ...(journey ? { journeyPhase: journey.journey.phase } : {}),
    guest: source.guest.firstName ? { firstName: source.guest.firstName } : {},
    property: { name: property.name, spokenName: property.spokenName, location: property.location },
    unit,
    status,
    ...(access ? { access } : {}),
    ...(preview ? { accessPreview: preview } : {}),
    upcoming,
    summary: {
      title: `${property.name} · ${source.unit.name}`,
      dates: new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: property.timeZone,
      }).formatRange(new Date(reservation.checkInAt), new Date(reservation.checkOutAt)),
      ...(reservation.guestCount
        ? {
            travellers: {
              adults: reservation.guestCount.adults,
              children: reservation.guestCount.children,
              total: reservation.guestCount.adults + reservation.guestCount.children,
            },
          }
        : {}),
      ...(firstCard
        ? {
            image: {
              src: firstCard.image.src,
              alt: text(firstCard.image.alt),
              focus: firstCard.image.focus,
            },
          }
        : {}),
      href: "/guide",
    },
    timeTile,
    ...(checkIn ? { checkIn } : {}),
    tiles: selectTiles({
      upcoming,
      journeyPhase: journey?.journey.phase,
      checkIn,
      access,
      payment: journey?.payment,
      timeTile,
      checkOut: localTime(reservation.checkOutAt),
      unit,
      stay: { dates: shortRange, title: `${property.name} · ${source.unit.name}` },
    }),
    cards: source.cards.map((card) => ({
      id: card.id,
      href: card.href,
      title: text(card.title),
      subtitle: text(card.subtitle),
      image: { src: card.image.src, alt: text(card.image.alt), focus: card.image.focus },
    })),
  };
}

function selectStatus(
  source: StaySource,
  now: Date,
  localTime: (iso: string) => LocalTime,
  journey: StayJourneyInput | undefined,
): StayStatus {
  const { checkInAt, checkOutAt } = source.reservation;
  if (!journey) return { kind: "check-out", today: false, ...localTime(checkOutAt) };
  const { phase, primaryAction, registration } = journey.journey;
  if (primaryAction === "online-check-in") {
    return {
      kind: "online-check-in",
      stepsRemaining: journey.assessment.stepsRemaining,
      href: CHECK_IN_HREF,
      started: registration === "in-progress",
    };
  }
  const beforeCheckIn = now.getTime() < Date.parse(checkInAt);
  if (phase === "before-arrival" || (phase === "arrival-day" && beforeCheckIn)) {
    return { kind: "check-in", ...localTime(checkInAt) };
  }
  return { kind: "check-out", today: phase === "departure-day", ...localTime(checkOutAt) };
}

const ACCESS_PHASES = new Set(["arrival-day", "in-stay", "departure-day"]);

function selectAccess(
  journey: StayJourneyInput,
  localTime: (iso: string) => LocalTime,
  text: (value: LocalizedText) => string,
): StayAccessView | undefined {
  if (!ACCESS_PHASES.has(journey.journey.phase)) return undefined;
  const { access } = journey;
  switch (access.status) {
    case "available":
      return {
        kind: "available",
        credentialType: access.credential.type,
        validFrom: localTime(access.credential.validFrom),
        ...(access.credential.instructions
          ? { instructions: text(access.credential.instructions) }
          : {}),
      };
    case "manual":
      return {
        kind: "manual",
        ...(access.instructions ? { instructions: text(access.instructions) } : {}),
      };
    case "pending":
      if (access.reason === "registration-required") {
        return { kind: "registration-required", href: CHECK_IN_HREF };
      }
      if (access.reason === "not-yet-released" && access.releasesAt) {
        return { kind: "not-yet-released", ...localTime(access.releasesAt) };
      }
      return { kind: "not-issued" };
  }
}

/** Payment states that ask the guest to act. Anything else – or no data – asks nothing. */
const PAYMENT_ACTION_STATES = new Set(["due", "failed"]);

/**
 * The two tiles under the greeting. Only true states. The right tile follows the guest's
 * situation (priority: payment required → open check-in → departure day → access released →
 * check-in done → apartment); the left one shows the stay or the next time, and takes the
 * apartment whenever the right one does not show it.
 */
export function selectTiles(input: {
  upcoming: boolean;
  journeyPhase: JourneyPhase | undefined;
  checkIn: CheckInCardView | undefined;
  access: StayAccessView | undefined;
  payment: StayPaymentInput | undefined;
  timeTile: Extract<StayStatus, { kind: "check-in" | "check-out" }>;
  checkOut: LocalTime;
  unit: { name: string; href: string };
  stay: { dates: string; title: string };
}): { start: StartTileView; accent: AccentTileView } {
  const { checkIn, unit, journeyPhase, access, payment } = input;
  const open = checkIn && checkIn.state !== "completed" ? checkIn : undefined;
  const released = access?.kind === "available" || access?.kind === "manual";

  const accent: AccentTileView =
    payment && PAYMENT_ACTION_STATES.has(payment.state)
      ? { kind: "payment", href: payment.href }
      : open
        ? open.state === "in-progress"
          ? {
              kind: "check-in",
              state: "in-progress",
              stepsRemaining: open.stepsRemaining,
              steps: open.steps,
              href: open.href,
            }
          : {
              kind: "check-in",
              state: "not-started",
              stepsRemaining: open.steps.length,
              steps: open.steps.map((id) => ({ id, done: false })),
              href: open.href,
            }
        : journeyPhase === "departure-day"
          ? { kind: "check-out", ...pickLocalTime(input.checkOut) }
          : journeyPhase === "arrival-day" && released
            ? { kind: "access", href: ACCESS_HREF }
            : checkIn?.state === "completed"
              ? {
                  kind: "check-in-completed",
                  ...(checkIn.occupancyChanged ? { occupancyChanged: true } : {}),
                }
              : { kind: "apartment", ...unit };

  const start: StartTileView = input.upcoming
    ? { kind: "stay", ...input.stay, href: unit.href }
    : accent.kind === "apartment" || accent.kind === "access"
      ? {
          kind: "time",
          which: input.timeTile.kind,
          today: input.timeTile.kind === "check-out" && input.timeTile.today,
          ...pickLocalTime(input.timeTile),
        }
      : { kind: "apartment", ...unit };
  return { start, accent };
}

function pickLocalTime(value: LocalTime): LocalTime {
  return { time: value.time, date: value.date, dateTime: value.dateTime };
}

/** The check-in card: open (not started / in progress) until departure day, completed before arrival. */
function selectCheckIn(journey: StayJourneyInput): CheckInCardView | undefined {
  const { phase, primaryAction, registration } = journey.journey;
  const steps = journey.assessment.steps;
  const visible = CHECK_IN_STEPS.filter((step) => steps?.[step] !== "skipped");
  if (primaryAction === "online-check-in") {
    if (registration === "not-started") {
      return { state: "not-started", href: CHECK_IN_HREF, steps: visible };
    }
    return {
      state: "in-progress",
      href: CHECK_IN_HREF,
      steps: visible.map((id) => ({ id, done: steps?.[id] === "complete" })),
      stepsRemaining: journey.assessment.stepsRemaining,
    };
  }
  if (registration === "completed" && phase === "before-arrival") {
    return {
      state: "completed",
      steps: visible.filter((step) => step !== "review"),
      ...(journey.guestRegistration ? { guestRegistration: journey.guestRegistration } : {}),
      ...(journey.occupancyChanged ? { occupancyChanged: true } : {}),
    };
  }
  return undefined;
}
