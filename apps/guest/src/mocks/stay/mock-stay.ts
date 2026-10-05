import { type StaySource } from "../../features/stay/model";
import interior from "./images/hov-living-room.webp";
import landscape from "./images/allgaeu-landscape.webp";
import stillLife from "./images/extras-still-life.webp";

/*
 * Mock stay for UI validation (Phase 2). Replaced by real data from our
 * database / Apaleo projection later – the screen only sees StaySource.
 *
 * Photos are placeholders cropped from the design reference until real
 * property photography is available.
 */

/** Fixed "now" inside the stay, so the screen shows the in-house state. */
export const MOCK_NOW = new Date("2026-08-29T12:00:00+02:00");

export const mockStay: StaySource = {
  guest: { firstName: "Laura" },
  property: {
    name: "HØV",
    spokenName: "Höv",
    location: "Altusried",
    timeZone: "Europe/Berlin",
  },
  unit: { name: "ROS" },
  reservation: {
    checkInAt: "2026-08-27T15:00:00+02:00",
    checkOutAt: "2026-08-31T10:00:00+02:00",
    onlineCheckIn: { status: "completed", stepsRemaining: 0 },
  },
  cards: [
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
      title: { de: "Allgäu entdecken", en: "Discover the Allgäu" },
      subtitle: { de: "Unsere Lieblingsplätze für Dich", en: "Our favourite places for you" },
      image: {
        src: landscape,
        alt: { de: "Allgäuer Berge im Abendlicht", en: "Allgäu mountains in the evening light" },
        focus: "50% 40%",
      },
    },
  ],
};
