import { type ContentImage, type ExplorePlace, type LocalizedText } from "@up/core";

import exterior from "../guide/images/hov-exterior.webp";
import interior from "../stay/images/hov-living-room.webp";
import landscape from "../stay/images/allgaeu-landscape.webp";
import stillLife from "../stay/images/extras-still-life.webp";
import innInterior from "./images/inn-interior.webp";

/*
 * Mock EXPLORE content for HØV (Phase 5).
 *
 * All places are fictitious development entries ("Beispiel-…" / "Sample …"):
 * no real businesses, addresses, phone numbers or opening hours. example.com is a
 * reserved domain. Photos are placeholders cropped from the design references.
 */

const tenantId = "unique-places";
const forHov = { level: "properties", propertyIds: ["hov"] } as const;

function image(
  source: { src: string; width: number; height: number; blurDataURL?: string },
  alt: LocalizedText,
): ContentImage {
  return {
    src: source.src,
    width: source.width,
    height: source.height,
    blurDataUrl: source.blurDataURL,
    alt,
  };
}

/** Intro of the EXPLORE overview per property (content, not UI text). */
export const exploreIntroByProperty: Readonly<
  Record<string, { title: LocalizedText; lead: LocalizedText }>
> = {
  hov: {
    title: { de: "Allgäu entdecken", en: "Discover the Allgäu" },
    lead: { de: "Unsere Lieblingsplätze für Dich.", en: "Our favourite places for you." },
  },
};

export const hovExplorePlaces: readonly ExplorePlace[] = [
  {
    id: "sample-inn",
    tenantId,
    scope: forHov,
    status: "published",
    slug: { de: "beispiel-gasthaus", en: "sample-inn" },
    title: { de: "Beispiel-Gasthaus", en: "Sample inn" },
    categories: ["food-drink"],
    shortDescription: {
      de: "Regionale Küche in der Gaststube",
      en: "Regional cooking in a cosy dining room",
    },
    recommendation: {
      de: "Wenn wir abends nicht selbst kochen wollen, gehen wir am liebsten hierhin. Bodenständig, regional und mit viel Liebe gekocht.",
      en: "When we don't feel like cooking in the evening, this is where we like to go. Down to earth, regional and cooked with care.",
    },
    description: [
      {
        de: "Die Gaststube ist warm und unkompliziert, die Karte klein und saisonal. Am schönsten ist es nach einem langen Tag draußen.",
        en: "The dining room is warm and relaxed, the menu small and seasonal. It is at its best after a long day outdoors.",
      },
    ],
    goodToKnow: {
      de: "Am Wochenende lohnt es sich, vorab einen Tisch zu reservieren.",
      en: "At weekends it is worth reserving a table in advance.",
    },
    images: [
      image(innInterior, {
        de: "Gaststube mit Holztischen und Hängeleuchten",
        en: "Dining room with wooden tables and pendant lights",
      }),
    ],
    address: { street: "Beispielweg 1", postalCode: "00000", city: "Musterort" },
    website: "https://example.com",
    phone: "+49 000 0000000",
    openingHours: { de: "Mittwoch bis Sonntag ab 17:00 Uhr", en: "Wednesday to Sunday from 5 pm" },
    bookingUrl: "https://example.com/reservieren",
    sortOrder: 10,
    featured: true,
  },
  {
    id: "sample-cafe",
    tenantId,
    scope: forHov,
    status: "published",
    slug: { de: "beispiel-cafe", en: "sample-cafe" },
    title: { de: "Beispiel-Café", en: "Sample café" },
    categories: ["food-drink"],
    shortDescription: {
      de: "Kaffee und Kuchen für den Nachmittag",
      en: "Coffee and cake for the afternoon",
    },
    images: [
      image(stillLife, {
        de: "Schale mit Feigen und Wasserkaraffe",
        en: "Bowl of figs and a water carafe",
      }),
    ],
    sortOrder: 20,
    featured: false,
  },
  {
    id: "sample-viewpoint",
    tenantId,
    scope: forHov,
    status: "published",
    slug: { de: "beispiel-aussichtspunkt", en: "sample-viewpoint" },
    title: { de: "Beispiel-Aussichtspunkt", en: "Sample viewpoint" },
    categories: ["nature"],
    shortDescription: {
      de: "Weiter Blick über Wiesen und Berge",
      en: "A wide view over meadows and mountains",
    },
    images: [image(landscape, { de: "Berge im Abendlicht", en: "Mountains in the evening light" })],
    sortOrder: 30,
    featured: false,
  },
  {
    id: "sample-trail",
    tenantId,
    scope: forHov,
    status: "published",
    slug: { de: "beispiel-rundweg", en: "sample-trail" },
    title: { de: "Beispiel-Rundweg", en: "Sample trail" },
    categories: ["active", "nature", "family"],
    shortDescription: {
      de: "Gemütliche Runde, auch mit Kindern",
      en: "An easy loop, also with children",
    },
    images: [
      image(landscape, { de: "Wiese mit Wald und Bergen", en: "Meadow with forest and mountains" }),
    ],
    sortOrder: 40,
    featured: false,
  },
  {
    id: "sample-museum",
    tenantId,
    scope: forHov,
    status: "published",
    slug: { de: "beispiel-museum", en: "sample-museum" },
    title: { de: "Beispiel-Museum", en: "Sample museum" },
    categories: ["culture"],
    shortDescription: {
      de: "Ein Stück Geschichte der Region",
      en: "A piece of the region's history",
    },
    images: [
      image(interior, { de: "Alte Stube mit Holzbalken", en: "Old parlour with timber beams" }),
    ],
    sortOrder: 50,
    featured: false,
  },
  {
    id: "sample-farm",
    tenantId,
    scope: forHov,
    status: "published",
    slug: { de: "beispiel-erlebnishof", en: "sample-farm" },
    title: { de: "Beispiel-Erlebnishof", en: "Sample farm" },
    categories: ["family"],
    shortDescription: {
      de: "Tiere, Wiesen und viel Platz zum Toben",
      en: "Animals, meadows and plenty of room to play",
    },
    images: [image(exterior, { de: "Holzhaus zwischen Bäumen", en: "Timber house among trees" })],
    sortOrder: 60,
    featured: false,
  },
];
