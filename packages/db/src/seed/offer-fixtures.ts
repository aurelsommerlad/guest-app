/**
 * Upselling demo content for the TEST property only (concept, Phase 1). Partners are
 * fictitious ("Beispiel-…" / "Sample …"); example.org is a reserved domain. Own services refer
 * to the real Apaleo services of the TEST property (TEST-ECI, TEST-LCO …) – their price and
 * availability come from the Extras catalog, not from here.
 *
 * Images: the development placeholders of the apps' public/fixtures folder, only with
 * `withImages` (local databases). Staging gets the texts only – images come from STAY's
 * image management once offers are maintained in the admin (Phase 3).
 */
import {
  type ContentImage,
  DEFAULT_AVAILABILITY,
  type OfferAvailability,
  type OfferInput,
  offerSchema,
  partnerSchema,
  type TenantContext,
} from "@up/core";

import { type Database } from "../client";
import { upsertOffer, upsertPartner } from "../repositories/offer-repository";

export const OFFER_FIXTURE_PROPERTY = "test-run";

/** Stable ids so the seed can be re-run (and the staging script stays idempotent). */
export const OFFER_FIXTURE_IDS = {
  partnerDairy: "5d0f0b8e-4a8a-4f0e-9b7e-0b7d2f1a0001",
  partnerGuide: "5d0f0b8e-4a8a-4f0e-9b7e-0b7d2f1a0002",
  earlyCheckIn: "7c3e2a10-1b2c-4d5e-8f90-0a1b2c3d0001",
  lateCheckOut: "7c3e2a10-1b2c-4d5e-8f90-0a1b2c3d0002",
  dog: "7c3e2a10-1b2c-4d5e-8f90-0a1b2c3d0003",
  parking: "7c3e2a10-1b2c-4d5e-8f90-0a1b2c3d0004",
  extraPerson: "7c3e2a10-1b2c-4d5e-8f90-0a1b2c3d0005",
  cheese: "7c3e2a10-1b2c-4d5e-8f90-0a1b2c3d0006",
  sunrise: "7c3e2a10-1b2c-4d5e-8f90-0a1b2c3d0007",
  dinner: "7c3e2a10-1b2c-4d5e-8f90-0a1b2c3d0008",
} as const;

function image(
  path: string,
  width: number,
  height: number,
  alt: ContentImage["alt"],
): ContentImage {
  return { src: `/fixtures/${path}.webp`, width, height, alt };
}

const IMAGES = {
  interior: image("explore/hov-living-room", 1575, 468, {
    de: "Wohnraum mit Holzbalken im Morgenlicht",
    en: "Living room with timber beams in the morning light",
  }),
  stillLife: image("explore/extras-still-life", 690, 576, {
    de: "Schale mit Feigen und eine Wasserkaraffe",
    en: "A bowl of figs and a water carafe",
  }),
  exterior: image("guide/hov-exterior", 776, 496, {
    de: "Das Haus mit Holzfassade, umgeben von Bäumen",
    en: "The house with its timber facade among trees",
  }),
  landscape: image("explore/allgaeu-landscape", 660, 516, {
    de: "Allgäuer Berge im Abendlicht",
    en: "Allgäu mountains in the evening light",
  }),
  inn: image("explore/inn-interior", 888, 560, {
    de: "Gaststube mit Holzvertäfelung",
    en: "Wood-panelled dining room",
  }),
};

type Fixture = Omit<OfferInput, "heroImage" | "availability"> & {
  id: string;
  availability: OfferAvailability;
  image?: keyof typeof IMAGES;
};

const prop = (sortOrder: number, extrasServiceId?: string) => [
  {
    propertyId: OFFER_FIXTURE_PROPERTY,
    sortOrder,
    ...(extrasServiceId ? { extrasServiceId } : {}),
  },
];

export const offerFixtures: readonly Fixture[] = [
  {
    id: OFFER_FIXTURE_IDS.earlyCheckIn,
    kind: "house-service",
    category: "arrival-departure",
    slug: { de: "frueher-einchecken", en: "early-check-in" },
    title: { de: "Früher ankommen", en: "Arrive earlier" },
    teaser: {
      de: "Das Apartment wartet schon auf Dich – ab 12 Uhr statt ab 16 Uhr.",
      en: "Your apartment is ready for you – from noon instead of 4 pm.",
    },
    body: {
      de: "Wer früh losfährt, soll nicht vor verschlossener Tür stehen. Wir bereiten Dein Apartment so vor, dass Du schon mittags ankommen kannst – Gepäck abstellen, Kaffee kochen, durchatmen.",
      en: "If you set off early, you shouldn't have to wait outside. We prepare your apartment so you can arrive at noon – drop your bags, make a coffee, breathe.",
    },
    details: {
      de: "Ab 12:00 Uhr am Anreisetag\nNach Verfügbarkeit des Apartments",
      en: "From 12:00 on the day of arrival\nSubject to apartment availability",
    },
    gallery: [],
    fulfillment: "instant",
    cancellation: { type: "free-until", hoursBefore: 48 },
    availability: {
      ...DEFAULT_AVAILABILITY,
      phases: ["before-arrival", "arrival-day"],
      focusPhases: ["before-arrival", "arrival-day"],
    },
    featured: true,
    sortOrder: 10,
    properties: prop(10, "TEST-ECI"),
    image: "interior",
  },
  {
    id: OFFER_FIXTURE_IDS.lateCheckOut,
    kind: "house-service",
    category: "arrival-departure",
    slug: { de: "spaeter-auschecken", en: "late-check-out" },
    title: { de: "Den letzten Morgen verlängern", en: "A longer last morning" },
    teaser: {
      de: "Auschecken um 14 Uhr – ein ruhiges Frühstück, ein letzter Spaziergang.",
      en: "Check out at 2 pm – a slow breakfast, one last walk.",
    },
    body: {
      de: "Der Abreisetag muss nicht hektisch sein. Mit dem späten Check-out bleibt das Apartment bis 14 Uhr Deins.",
      en: "Departure day doesn't have to be rushed. With a late check-out the apartment stays yours until 2 pm.",
    },
    details: { de: "Bis 14:00 Uhr am Abreisetag", en: "Until 14:00 on the day of departure" },
    gallery: [],
    fulfillment: "instant",
    cancellation: { type: "free-until", hoursBefore: 24 },
    availability: { ...DEFAULT_AVAILABILITY, focusPhases: ["in-stay", "departure-day"] },
    featured: true,
    sortOrder: 20,
    properties: prop(20, "TEST-LCO"),
    image: "stillLife",
  },
  {
    id: OFFER_FIXTURE_IDS.dog,
    kind: "house-service",
    category: "pets",
    slug: { de: "mit-hund", en: "with-your-dog" },
    title: { de: "Mit Hund", en: "With your dog" },
    teaser: {
      de: "Dein Hund ist willkommen – mit Decke und Napf im Apartment.",
      en: "Your dog is welcome – with a blanket and bowl in the apartment.",
    },
    details: {
      de: "Ein Hund pro Apartment\nPreis pro Nacht",
      en: "One dog per apartment\nPrice per night",
    },
    gallery: [],
    fulfillment: "instant",
    cancellation: { type: "free-until", hoursBefore: 48 },
    availability: { ...DEFAULT_AVAILABILITY, phases: ["before-arrival", "arrival-day"] },
    featured: false,
    sortOrder: 30,
    properties: prop(30, "TEST-HUND"),
    image: "exterior",
  },
  {
    id: OFFER_FIXTURE_IDS.parking,
    kind: "house-service",
    category: "mobility",
    slug: { de: "parkplatz", en: "parking" },
    title: { de: "Ein Platz für Dein Auto", en: "A space for your car" },
    teaser: {
      de: "Reserviert direkt am Haus – mit Deinem Kennzeichen hinterlegt.",
      en: "Reserved right by the house – registered with your number plate.",
    },
    gallery: [],
    fulfillment: "instant",
    cancellation: { type: "free-until", hoursBefore: 24 },
    availability: {
      ...DEFAULT_AVAILABILITY,
      phases: ["before-arrival", "arrival-day"],
      focusPhases: ["arrival-day"],
    },
    featured: false,
    sortOrder: 40,
    properties: prop(40, "TEST-PKW"),
    image: "exterior",
  },
  {
    id: OFFER_FIXTURE_IDS.extraPerson,
    kind: "house-service",
    category: "comfort",
    slug: { de: "zusaetzliche-person", en: "extra-person" },
    title: { de: "Noch jemand kommt mit", en: "Someone else is coming" },
    teaser: {
      de: "Eine weitere Person zur Buchung hinzufügen – wenn das Apartment Platz hat.",
      en: "Add another person to your booking – if the apartment has room.",
    },
    gallery: [],
    fulfillment: "request",
    cancellation: { type: "on-request" },
    availability: { ...DEFAULT_AVAILABILITY, phases: ["before-arrival"] },
    featured: false,
    sortOrder: 50,
    properties: prop(50, "TEST-EXTRPERSON"),
  },
  {
    id: OFFER_FIXTURE_IDS.cheese,
    kind: "partner",
    partnerId: OFFER_FIXTURE_IDS.partnerDairy,
    category: "food-drink",
    slug: { de: "kaeserei-besuch", en: "dairy-visit" },
    title: { de: "Ein Vormittag in der Sennerei", en: "A morning at the dairy" },
    teaser: {
      de: "Zuschauen, wie Bergkäse entsteht – und danach probieren. (Beispielangebot)",
      en: "Watch mountain cheese being made – then taste it. (Sample offer)",
    },
    body: {
      de: "Früh am Morgen wird die Milch der umliegenden Höfe verarbeitet. Die Sennerin zeigt Dir den Kessel, den Keller und erzählt, warum ein Laib zwölf Monate reifen darf.\n\nZum Abschluss gibt es eine Verkostung mit Brot und Most.",
      en: "Early in the morning the milk from the surrounding farms is processed. The cheesemaker shows you the vat and the cellar and tells you why a wheel may mature for twelve months.\n\nTo finish, a tasting with bread and cider.",
    },
    details: {
      de: "Dienstag bis Samstag, 9:30 Uhr\nDauer etwa zwei Stunden\nAnfrage über UNIQUE PLACES",
      en: "Tuesday to Saturday, 9:30\nAbout two hours\nRequest via UNIQUE PLACES",
    },
    gallery: [],
    fulfillment: "request",
    price: { model: "per-person", amountCents: 2400, currency: "EUR" },
    durationMinutes: 120,
    cancellation: { type: "free-until", hoursBefore: 24 },
    commission: { type: "percent", basisPoints: 1000 },
    availability: {
      ...DEFAULT_AVAILABILITY,
      phases: ["before-arrival", "arrival-day", "in-stay"],
      focusPhases: ["in-stay"],
      weekdays: [2, 3, 4, 5, 6],
    },
    featured: true,
    sortOrder: 10,
    properties: prop(110),
    image: "stillLife",
  },
  {
    id: OFFER_FIXTURE_IDS.sunrise,
    kind: "partner",
    partnerId: OFFER_FIXTURE_IDS.partnerGuide,
    category: "nature",
    slug: { de: "sonnenaufgang-am-grat", en: "sunrise-on-the-ridge" },
    title: { de: "Sonnenaufgang am Grat", en: "Sunrise on the ridge" },
    teaser: {
      de: "Mit einem Bergführer zum ersten Licht – kleine Gruppe, leichter Weg. (Beispielangebot)",
      en: "With a mountain guide to the first light – small group, easy path. (Sample offer)",
    },
    body: {
      de: "Aufbruch in der Dunkelheit, Stirnlampe, Stille. Oben angekommen färbt sich der Himmel über den Gipfeln – dazu heißer Tee aus der Thermoskanne.",
      en: "Setting off in the dark, a head torch, silence. At the top the sky above the peaks turns colour – with hot tea from a flask.",
    },
    details: {
      de: "Treffpunkt am Parkplatz Talstation\nDauer etwa vier Stunden\nGute Schuhe erforderlich",
      en: "Meeting point: valley station car park\nAbout four hours\nSturdy shoes required",
    },
    gallery: [],
    fulfillment: "link",
    bookingUrl: "https://example.org/bergfuehrer/sonnenaufgang",
    price: { model: "from", amountCents: 4900, currency: "EUR" },
    durationMinutes: 240,
    cancellation: { type: "partner-terms" },
    availability: {
      ...DEFAULT_AVAILABILITY,
      phases: ["before-arrival", "in-stay"],
      focusPhases: ["in-stay"],
      seasons: [{ from: "05-01", to: "10-31" }],
    },
    featured: false,
    sortOrder: 20,
    properties: prop(120),
    image: "landscape",
  },
  {
    id: OFFER_FIXTURE_IDS.dinner,
    kind: "partner",
    partnerId: OFFER_FIXTURE_IDS.partnerDairy,
    category: "food-drink",
    slug: { de: "abendessen-in-der-stube", en: "dinner-in-the-parlour" },
    title: { de: "Abendessen in der Stube", en: "Dinner in the parlour" },
    teaser: {
      de: "Vier Gänge aus der Region, ein Tisch am Kachelofen – wir reservieren für Dich. (Beispielangebot)",
      en: "Four regional courses, a table by the tiled stove – we book it for you. (Sample offer)",
    },
    body: {
      de: "Ein Abend ohne Planung: Wir fragen den Tisch für Dich an und melden uns mit der Bestätigung.",
      en: "An evening without planning: we request the table for you and get back to you with the confirmation.",
    },
    gallery: [],
    fulfillment: "request",
    price: { model: "per-person", amountCents: 6500, currency: "EUR" },
    durationMinutes: 150,
    cancellation: { type: "free-until", hoursBefore: 24 },
    availability: {
      ...DEFAULT_AVAILABILITY,
      phases: ["before-arrival", "arrival-day", "in-stay"],
      focusPhases: ["arrival-day", "in-stay"],
    },
    featured: false,
    sortOrder: 30,
    properties: prop(130),
    image: "inn",
  },
];

export const partnerFixtures = [
  {
    id: OFFER_FIXTURE_IDS.partnerDairy,
    name: "Beispiel-Sennerei",
    status: "active" as const,
    websiteUrl: "https://example.org/sennerei",
    commission: { type: "percent" as const, basisPoints: 800 },
  },
  {
    id: OFFER_FIXTURE_IDS.partnerGuide,
    name: "Beispiel-Bergführer",
    status: "active" as const,
    websiteUrl: "https://example.org/bergfuehrer",
    commission: { type: "fixed" as const, amountCents: 500, currency: "EUR" },
  },
];

/** Validated input of all fixtures (images only with `withImages`). */
export function offerFixtureInputs(withImages: boolean) {
  const schema = offerSchema((src) => src.startsWith("/fixtures/"));
  return offerFixtures.map(({ id, image: key, ...fixture }) => ({
    id,
    status: "published" as const,
    ...schema.parse({ ...fixture, ...(withImages && key ? { heroImage: IMAGES[key] } : {}) }),
  }));
}

export async function seedOfferFixtures(
  db: Database,
  context: TenantContext,
  options: { withImages: boolean },
): Promise<number> {
  for (const partner of partnerFixtures) {
    const { id, ...input } = partner;
    await upsertPartner(db, context, { id, ...partnerSchema.parse(input) });
  }
  const inputs = offerFixtureInputs(options.withImages);
  for (const input of inputs) await upsertOffer(db, context, input);
  return inputs.length;
}
