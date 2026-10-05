import { type ContentImage, type GuideSection } from "@up/core";

import exterior from "./images/hov-exterior.webp";

/*
 * Mock GUIDE content for HØV (Phase 3). Structure and presentation only:
 * no real parking numbers, codes or addresses. Only "arrival & parking" has
 * detail content; the other sections are listed with title and description.
 *
 * Shape = future database rows (one per section, blocks as JSON).
 */

const tenantId = "unique-places";
const hov = { level: "property", propertyId: "hov" } as const;

const exteriorImage: ContentImage = {
  src: exterior.src,
  width: exterior.width,
  height: exterior.height,
  blurDataUrl: exterior.blurDataURL,
  alt: {
    de: "Das Haus HØV mit Holzfassade, umgeben von Bäumen",
    en: "The HØV house with its timber facade, surrounded by trees",
  },
};

export const hovGuideSections: readonly GuideSection[] = [
  {
    id: "hov-arrival-parking",
    tenantId,
    key: "arrival-parking",
    scope: hov,
    status: "published",
    slug: { de: "ankunft-parken", en: "arrival-parking" },
    eyebrow: { de: "Ankunft", en: "Arrival" },
    title: { de: "Ankunft & Parken", en: "Arrival & parking" },
    shortDescription: {
      de: "Anreise, Parken und Self-Check-in",
      en: "Getting here, parking and self check-in",
    },
    icon: "car",
    sortOrder: 10,
    intro: {
      de: "Schön, dass Du bald bei uns bist. Hier findest Du alles für eine entspannte Ankunft.",
      en: "We are glad you will be with us soon. Here is everything for a relaxed arrival.",
    },
    heroImage: exteriorImage,
    blocks: [
      { id: "parking-heading", type: "heading", text: { de: "Parken", en: "Parking" } },
      {
        id: "parking-text",
        type: "paragraph",
        text: {
          de: "Du parkst direkt an der Unterkunft. Folge vor Ort einfach der Beschilderung – so findest Du Deinen Stellplatz ganz unkompliziert.",
          en: "You park right at the house. Simply follow the signs on site to find your parking space easily.",
        },
      },
      {
        id: "checkin-heading",
        type: "heading",
        text: { de: "Self-Check-in", en: "Self check-in" },
      },
      {
        id: "checkin-text",
        type: "paragraph",
        text: {
          de: "Bei uns checkst Du selbstständig ein, ganz ohne Wartezeit. Den Zugang zu Haus und Apartment erhältst Du über unsere Keybox.",
          en: "You check in on your own, without any waiting. You get access to the house and your apartment via our key box.",
        },
      },
      {
        id: "at-a-glance",
        type: "list",
        style: "bullet",
        items: [
          { de: "Check-in ab 16:00 Uhr", en: "Check-in from 4 pm" },
          { de: "Parken direkt an der Unterkunft", en: "Parking right at the house" },
          { de: "Zugang über die Keybox", en: "Access via the key box" },
        ],
      },
      {
        id: "signage-hint",
        type: "callout",
        title: { de: "Gut zu wissen", en: "Good to know" },
        text: {
          de: "Die Beschilderung vor Ort führt Dich zu Parkplatz und Eingang.",
          en: "The signs on site lead you to the car park and the entrance.",
        },
      },
    ],
  },
  listed(
    "hov-wifi",
    "wifi",
    20,
    "wifi",
    { de: "wlan", en: "wifi" },
    { de: "WLAN", en: "Wi-Fi" },
    {
      de: "Netzwerk und Passwort",
      en: "Network and password",
    },
  ),
  listed(
    "hov-apartment",
    "apartment",
    30,
    "home",
    { de: "apartment", en: "apartment" },
    { de: "Dein Apartment", en: "Your apartment" },
    {
      de: "Räume, Ausstattung und Besonderheiten",
      en: "Rooms, furnishings and details",
    },
  ),
  listed(
    "hov-appliances",
    "appliances",
    40,
    "plug",
    { de: "geraete-ausstattung", en: "appliances" },
    { de: "Geräte & Ausstattung", en: "Appliances & equipment" },
    {
      de: "Küche, Kaffee, TV und mehr",
      en: "Kitchen, coffee, TV and more",
    },
  ),
  listed(
    "hov-heating",
    "heating",
    50,
    "thermometer",
    { de: "heizung-lueften", en: "heating-ventilation" },
    { de: "Heizung & Lüften", en: "Heating & ventilation" },
    {
      de: "Für ein angenehmes Raumklima",
      en: "For a pleasant indoor climate",
    },
  ),
  listed(
    "hov-waste",
    "waste",
    60,
    "trash",
    { de: "muell-recycling", en: "waste-recycling" },
    { de: "Müll & Recycling", en: "Waste & recycling" },
    {
      de: "Trennen und entsorgen",
      en: "Sorting and disposal",
    },
  ),
  listed(
    "hov-house-rules",
    "house-rules",
    70,
    "book-open",
    { de: "hausregeln", en: "house-rules" },
    { de: "Hausregeln", en: "House rules" },
    {
      de: "Ruhezeiten, Rauchen, Haustiere",
      en: "Quiet hours, smoking, pets",
    },
  ),
  listed(
    "hov-check-out",
    "check-out",
    80,
    "log-out",
    { de: "check-out", en: "check-out" },
    { de: "Check-out", en: "Check-out" },
    {
      de: "Abreise und letzte Schritte",
      en: "Departure and final steps",
    },
  ),
];

/** A section that is listed but has no detail content yet. */
function listed(
  id: string,
  key: string,
  sortOrder: number,
  icon: GuideSection["icon"],
  slug: GuideSection["slug"],
  title: GuideSection["title"],
  shortDescription: GuideSection["shortDescription"],
): GuideSection {
  return {
    id,
    tenantId,
    key,
    scope: hov,
    status: "published",
    slug,
    title,
    shortDescription,
    icon,
    sortOrder,
    blocks: [],
  };
}
