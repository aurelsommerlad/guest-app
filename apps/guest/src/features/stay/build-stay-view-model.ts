import {
  deriveStayPhase,
  type GuestJourney,
  type LocalizedText,
  type RegistrationAssessment,
  resolveLocalizedText,
  type StayAccess,
} from "@up/core";

import { type Locale, routing } from "../../i18n/routing";
import {
  type LocalTime,
  type StayAccessView,
  type StaySource,
  type StayStatus,
  type StayViewModel,
} from "./model";

/** Journey data STAY needs (from features/journey). */
export type StayJourneyInput = {
  journey: GuestJourney;
  assessment: Pick<RegistrationAssessment, "stepsRemaining">;
  access: StayAccess;
};

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
  return {
    locale,
    phase,
    ...(journey ? { journeyPhase: journey.journey.phase } : {}),
    guest: source.guest.firstName ? { firstName: source.guest.firstName } : {},
    property: { name: property.name, spokenName: property.spokenName, location: property.location },
    unit: { name: source.unit.name, href: "/guide" },
    status: selectStatus(source, now, localTime, journey),
    ...(access ? { access } : {}),
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
