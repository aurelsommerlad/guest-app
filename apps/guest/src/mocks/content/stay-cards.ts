import { type StayCardSource } from "../../features/stay/model";
import interior from "../stay/images/hov-living-room.webp";
import landscape from "../stay/images/allgaeu-landscape.webp";
import stillLife from "../stay/images/extras-still-life.webp";

/*
 * Content of the photographic STAY cards per property (mock content, Phase 4).
 * Later: stored with the property's content in our database.
 * Photos are placeholders cropped from the design reference.
 */

/** Tenant default, currently the HØV cards. */
const defaultCards: readonly StayCardSource[] = [
  {
    id: "guide",
    href: "/guide",
    title: { de: "Alles für Deinen Aufenthalt", en: "Everything for your stay" },
    subtitle: {
      de: "WLAN, Geräte, Haus & Apartment",
      en: "Wi-Fi, appliances, house & apartment",
    },
    image: {
      src: interior,
      alt: {
        de: "Wohnraum mit Holzbalken und Sofa",
        en: "Living room with timber beams and sofa",
      },
      focus: "60% 50%",
    },
  },
  {
    id: "extras",
    href: "/extras",
    title: { de: "Extras", en: "Extras" },
    subtitle: {
      de: "Mach Deinen Aufenthalt noch schöner",
      en: "Make your stay even more special",
    },
    image: {
      src: stillLife,
      alt: { de: "Schale mit Feigen und Wasserkaraffe", en: "Bowl of figs and a water carafe" },
      focus: "40% 55%",
    },
  },
  {
    id: "explore",
    href: "/explore",
    title: { de: "Das Allgäu entdecken", en: "Discover the Allgäu" },
    subtitle: { de: "Unsere Lieblingsplätze für Dich", en: "Our favourite places for you" },
    image: {
      src: landscape,
      alt: { de: "Allgäuer Berge im Abendlicht", en: "Allgäu mountains in the evening light" },
      focus: "50% 40%",
    },
  },
];

/** Same cards, EXPLORE named after the property's region (photos: tenant default for now). */
function withRegion(title: StayCardSource["title"]): readonly StayCardSource[] {
  return defaultCards.map((card) => (card.id === "explore" ? { ...card, title } : card));
}

const cardsByProperty: Readonly<Record<string, readonly StayCardSource[]>> = {
  hov: defaultCards,
  laeke: withRegion({ de: "Den Bodensee entdecken", en: "Discover Lake Constance" }),
  huesle: withRegion({ de: "Vorarlberg entdecken", en: "Discover Vorarlberg" }),
  alpila: withRegion({ de: "Das Montafon entdecken", en: "Discover the Montafon" }),
};

/** Cards for a property, falling back to the tenant default until property content exists. */
export function stayCardsForProperty(propertyId: string): readonly StayCardSource[] {
  return cardsByProperty[propertyId] ?? defaultCards;
}
