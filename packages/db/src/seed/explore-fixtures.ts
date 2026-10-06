/**
 * EXPLORE test fixtures – ONLY for local development and automated tests
 * (`pnpm db:seed --target local --with-explore-fixtures`; the CLI rejects other targets).
 *
 * All places are fictitious ("Beispiel-…" / "Sample …"): no real businesses, addresses or
 * phone numbers; example.com/.org are reserved domains. Images are served from the apps'
 * public/fixtures folder and exist only in local builds' data – never in staging.
 */
import { type ContentImage, type TenantContext } from "@up/core";
import { and, eq, sql } from "drizzle-orm";

import { type Database } from "../client";
import {
  createExplorePlace,
  type ExplorePlaceFields,
  setExplorePlaceStatus,
} from "../repositories/explore-repository";
import { explorePlaces } from "../schema";

function image(
  file: string,
  width: number,
  height: number,
  alt: ContentImage["alt"],
): ContentImage {
  return { src: `/fixtures/explore/${file}.webp`, width, height, alt };
}

type Fixture = ExplorePlaceFields & { sortOrder: number; publish: boolean };

const reviewed = { en: "reviewed" } as const;

export const exploreFixtures: readonly Fixture[] = [
  {
    category: "food-drink",
    slug: { de: "beispiel-gasthaus", en: "sample-inn" },
    title: { de: "Beispiel-Gasthaus", en: "Sample inn" },
    teaser: {
      de: "Regionale Küche in der Gaststube",
      en: "Regional cooking in a cosy dining room",
    },
    tip: {
      de: "Wenn wir abends nicht selbst kochen wollen, gehen wir am liebsten hierhin. Bodenständig, regional und mit viel Liebe gekocht.",
      en: "When we don't feel like cooking in the evening, this is where we like to go. Down to earth, regional and cooked with care.",
    },
    description: {
      de: "Die Gaststube ist warm und unkompliziert, die Karte klein und saisonal.\n\nAm schönsten ist es nach einem langen Tag draußen.",
      en: "The dining room is warm and relaxed, the menu small and seasonal.\n\nIt is at its best after a long day outdoors.",
    },
    openingHours: { de: "Mittwoch bis Sonntag ab 17:00 Uhr", en: "Wednesday to Sunday from 5 pm" },
    heroImage: image("inn-interior", 888, 560, {
      de: "Gaststube mit Holztischen und Hängeleuchten",
      en: "Dining room with wooden tables and pendant lights",
    }),
    address: "Beispielweg 1\n00000 Musterort",
    locality: "Musterort",
    websiteUrl: "https://example.com",
    phone: "+49 000 0000000",
    reservationUrl: "https://example.com/reservieren",
    featured: true,
    translationState: reviewed,
    propertyIds: ["hov"],
    sortOrder: 10,
    publish: true,
  },
  {
    category: "food-drink",
    slug: { de: "beispiel-cafe", en: "sample-cafe" },
    title: { de: "Beispiel-Café", en: "Sample café" },
    teaser: { de: "Kaffee und Kuchen für den Nachmittag", en: "Coffee and cake for the afternoon" },
    heroImage: image("extras-still-life", 690, 576, {
      de: "Schale mit Feigen und Wasserkaraffe",
      en: "Bowl of figs and a water carafe",
    }),
    locality: "Musterort",
    featured: false,
    translationState: reviewed,
    propertyIds: ["hov", "laeke"],
    sortOrder: 20,
    publish: true,
  },
  {
    category: "nature",
    slug: { de: "beispiel-aussichtspunkt", en: "sample-viewpoint" },
    title: { de: "Beispiel-Aussichtspunkt", en: "Sample viewpoint" },
    teaser: {
      de: "Weiter Blick über Wiesen und Berge",
      en: "A wide view over meadows and mountains",
    },
    heroImage: image("allgaeu-landscape", 660, 516, {
      de: "Berge im Abendlicht",
      en: "Mountains in the evening light",
    }),
    mapsUrl: "https://example.org/karte/aussichtspunkt",
    featured: false,
    translationState: reviewed,
    propertyIds: ["hov"],
    sortOrder: 30,
    publish: true,
  },
  {
    category: "sights",
    slug: { de: "beispiel-museum" },
    title: { de: "Beispiel-Museum" },
    teaser: { de: "Ein Stück Geschichte der Region" },
    heroImage: image("hov-living-room", 1575, 468, { de: "Alte Stube mit Holzbalken" }),
    locality: "Musterstadt",
    featured: false,
    translationState: { en: "missing" },
    propertyIds: ["hov"],
    sortOrder: 40,
    publish: true,
  },
  {
    category: "wellness",
    slug: { de: "beispiel-seebad", en: "sample-lido" },
    title: { de: "Beispiel-Seebad", en: "Sample lido" },
    teaser: { de: "Schwimmen mit Blick aufs Wasser", en: "Swimming with a view of the water" },
    featured: false,
    translationState: reviewed,
    propertyIds: ["laeke"],
    sortOrder: 50,
    publish: true,
  },
  {
    category: "activities",
    slug: { de: "beispiel-radtour" },
    title: { de: "Beispiel-Radtour" },
    teaser: { de: "Entwurf – noch nicht veröffentlicht" },
    featured: false,
    translationState: { en: "missing" },
    propertyIds: ["hov"],
    sortOrder: 60,
    publish: false,
  },
  {
    category: "shopping",
    slug: { de: "beispiel-hofladen" },
    title: { de: "Beispiel-Hofladen" },
    teaser: { de: "Noch keinem Objekt zugeordnet" },
    featured: false,
    translationState: { en: "missing" },
    propertyIds: [],
    sortOrder: 70,
    publish: true,
  },
];

/** Idempotent: creates only fixtures whose German slug does not exist yet. */
export async function seedExploreFixtures(
  db: Database,
  context: TenantContext,
  now: Date = new Date(),
): Promise<{ written: number }> {
  let written = 0;
  for (const { publish, ...fixture } of exploreFixtures) {
    const [existing] = await db
      .select({ id: explorePlaces.id })
      .from(explorePlaces)
      .where(
        and(
          eq(explorePlaces.tenantId, context.tenantId),
          sql`${explorePlaces.slug} ->> 'de' = ${fixture.slug.de ?? ""}`,
        ),
      );
    if (existing) continue;
    const place = await createExplorePlace(db, context, fixture);
    if (publish) await setExplorePlaceStatus(db, context, place.id, "published", now);
    written++;
  }
  return { written };
}
