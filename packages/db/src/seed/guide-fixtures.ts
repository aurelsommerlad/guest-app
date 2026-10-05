/**
 * Development fixtures for GUIDE (ADR 0013) – LOCAL DATABASES AND TESTS ONLY.
 *
 * The former in-code mock content of HØV (Phase 3): structure and presentation only, no
 * real parking numbers, codes, Wi-Fi data or addresses. The CLI refuses to write these
 * into staging or production; real content is created in the admin app.
 */
import { type TenantContext } from "@up/core";
import { and, eq } from "drizzle-orm";

import { type Database } from "../client";
import {
  createGuideTopic,
  type NewGuideTopic,
  setGuideEntryStatus,
} from "../repositories/guide-repository";
import { guideSections } from "../schema";

const hov = { level: "property", propertyId: "hov" } as const;

/** Served by the guest app from public/fixtures (development placeholder photo). */
const exteriorImage = {
  src: "/fixtures/guide/hov-exterior.webp",
  width: 776,
  height: 496,
  alt: {
    de: "Das Haus HØV mit Holzfassade, umgeben von Bäumen",
    en: "The HØV house with its timber facade, surrounded by trees",
  },
};

function listed(
  key: string,
  sortOrder: number,
  icon: NewGuideTopic["icon"],
  slug: { de: string; en: string },
  title: { de: string; en: string },
  shortDescription: { de: string; en: string },
): NewGuideTopic {
  return {
    key,
    scope: hov,
    sortOrder,
    icon,
    slug,
    title,
    shortDescription,
    blocks: [],
    translationState: { en: "reviewed" },
  };
}

export const guideFixtures: readonly NewGuideTopic[] = [
  {
    key: "arrival-parking",
    scope: hov,
    sortOrder: 10,
    icon: "car",
    slug: { de: "ankunft-parken", en: "arrival-parking" },
    eyebrow: { de: "Ankunft", en: "Arrival" },
    title: { de: "Ankunft & Parken", en: "Arrival & parking" },
    shortDescription: {
      de: "Anreise, Parken und Self-Check-in",
      en: "Getting here, parking and self check-in",
    },
    intro: {
      de: "Schön, dass Du bald bei uns bist. Hier findest Du alles für eine entspannte Ankunft.",
      en: "We are glad you will be with us soon. Here is everything for a relaxed arrival.",
    },
    heroImage: exteriorImage,
    translationState: { en: "reviewed" },
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
    "apartment",
    30,
    "home",
    { de: "apartment", en: "apartment" },
    { de: "Dein Apartment", en: "Your apartment" },
    { de: "Räume, Ausstattung und Besonderheiten", en: "Rooms, furnishings and details" },
  ),
  listed(
    "appliances",
    40,
    "plug",
    { de: "geraete-ausstattung", en: "appliances" },
    { de: "Geräte & Ausstattung", en: "Appliances & equipment" },
    { de: "Küche, Kaffee, TV und mehr", en: "Kitchen, coffee, TV and more" },
  ),
  listed(
    "heating",
    50,
    "thermometer",
    { de: "heizung-lueften", en: "heating-ventilation" },
    { de: "Heizung & Lüften", en: "Heating & ventilation" },
    { de: "Für ein angenehmes Raumklima", en: "For a pleasant indoor climate" },
  ),
  listed(
    "waste",
    60,
    "trash",
    { de: "muell-recycling", en: "waste-recycling" },
    { de: "Müll & Recycling", en: "Waste & recycling" },
    { de: "Trennen und entsorgen", en: "Sorting and disposal" },
  ),
  listed(
    "house-rules",
    70,
    "book-open",
    { de: "hausregeln", en: "house-rules" },
    { de: "Hausregeln", en: "House rules" },
    { de: "Ruhezeiten, Rauchen, Haustiere", en: "Quiet hours, smoking, pets" },
  ),
  listed(
    "check-out",
    80,
    "log-out",
    { de: "check-out", en: "check-out" },
    { de: "Check-out", en: "Check-out" },
    { de: "Abreise und letzte Schritte", en: "Departure and final steps" },
  ),
];

/** Idempotent: creates (and publishes) only fixtures whose key does not exist yet. */
export async function seedGuideFixtures(
  db: Database,
  context: TenantContext,
  now: Date = new Date(),
): Promise<{ written: number }> {
  let written = 0;
  for (const fixture of guideFixtures) {
    const [existing] = await db
      .select({ id: guideSections.id })
      .from(guideSections)
      .where(
        and(
          eq(guideSections.tenantId, context.tenantId),
          eq(guideSections.propertyId, fixture.scope.propertyId),
          eq(guideSections.kind, "topic"),
          eq(guideSections.key, fixture.key),
        ),
      );
    if (existing) continue;
    const topic = await createGuideTopic(db, context, fixture);
    await setGuideEntryStatus(db, context, topic.id, "published", now);
    written++;
  }
  return { written };
}
