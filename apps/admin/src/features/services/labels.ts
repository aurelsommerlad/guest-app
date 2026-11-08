import type { BOOKING_RULES, HOUSE_SERVICE_CATEGORIES } from "@up/core";

/** Labels shared by server views and client forms (plain module – no "use client"). */
export const CATEGORY_LABELS: Record<(typeof HOUSE_SERVICE_CATEGORIES)[number], string> = {
  "arrival-departure": "An- und Abreise",
  "longer-stay": "Länger bleiben",
  mobility: "Mobilität",
  pets: "Mit Hund",
  comfort: "Komfort",
  food: "Genuss",
};

export const BOOKING_RULE_LABELS: Record<(typeof BOOKING_RULES)[number], string> = {
  per_stay: "Pro Aufenthalt (einmal)",
  per_night: "Pro Nacht",
  arrival_day: "Am Anreisetag",
  departure_day: "Am Abreisetag",
};
