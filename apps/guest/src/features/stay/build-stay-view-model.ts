import { deriveStayPhase, resolveLocalizedText } from "@up/core";

import { type Locale, routing } from "../../i18n/routing";
import { type StaySource, type StayStatus, type StayViewModel } from "./model";

/**
 * Turns stay source data into the screen's view model: derives the phase,
 * picks the primary tile, formats dates in the property's time zone and
 * resolves translated content. Pure – `now` is injected.
 */
export function buildStayViewModel(source: StaySource, locale: Locale, now: Date): StayViewModel {
  const { reservation, property } = source;
  const phase = deriveStayPhase(reservation, now);
  const text = (value: Parameters<typeof resolveLocalizedText>[0]) =>
    resolveLocalizedText(value, locale, routing.defaultLocale);

  return {
    locale,
    phase,
    guest: { firstName: source.guest.firstName },
    property: { name: property.name, spokenName: property.spokenName, location: property.location },
    unit: { name: source.unit.name, href: "/guide" },
    status: selectStatus(source, phase, locale),
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
  phase: StayViewModel["phase"],
  locale: Locale,
): StayStatus {
  const { onlineCheckIn, checkOutAt } = source.reservation;
  if (phase === "pre-arrival" && onlineCheckIn.status === "open") {
    return {
      kind: "online-check-in",
      stepsRemaining: onlineCheckIn.stepsRemaining,
      href: "/check-in",
    };
  }
  const checkOut = new Date(checkOutAt);
  const timeZone = source.property.timeZone;
  return {
    kind: "check-out",
    time: new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone }).format(checkOut),
    date: new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone }).format(checkOut),
    dateTime: checkOutAt,
  };
}
