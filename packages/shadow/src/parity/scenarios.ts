/**
 * Parity scenarios: the same Extras configuration and the same simulated Apaleo state, run once
 * through the Extras code and once through the STAY engine.
 */
import { type SimState } from "./simulator-state";

/** The Extras catalog of the TEST property as stored in Extras (catalog:TEST:items). */
export const EXTRAS_CATALOG: Record<string, Record<string, unknown>> = {
  "TEST-ECI": {
    serviceId: "TEST-ECI",
    code: "ECI",
    active: true,
    displayNameDe: "Früher Check-in",
    displayNameEn: "Early check-in",
    bookingRule: "arrival_day",
    fulfillmentMode: "instant",
    sortOrder: 1,
  },
  "TEST-LCO": {
    serviceId: "TEST-LCO",
    code: "LCO",
    active: true,
    displayNameDe: "Später Check-out",
    displayNameEn: "Late check-out",
    bookingRule: "departure_day",
    fulfillmentMode: "instant",
    sortOrder: 2,
  },
  "TEST-HUND": {
    serviceId: "TEST-HUND",
    code: "HUND",
    active: true,
    displayNameDe: "Hund",
    displayNameEn: "Dog",
    bookingRule: "per_night",
    fulfillmentMode: "instant",
    maxOnePerReservation: true,
    sortOrder: 3,
  },
  "TEST-PKW": {
    serviceId: "TEST-PKW",
    code: "PKW",
    active: true,
    displayNameDe: "Parkplatz",
    displayNameEn: "Parking",
    bookingRule: "per_night",
    fulfillmentMode: "instant",
    requiresVehicleRegistration: true,
    sortOrder: 4,
  },
  "TEST-BABY": {
    serviceId: "TEST-BABY",
    code: "BABY",
    active: true,
    displayNameDe: "Babybett",
    displayNameEn: "Baby cot",
    bookingRule: "per_stay",
    fulfillmentMode: "request",
    sortOrder: 5,
  },
  "TEST-EXTRPERSON": {
    serviceId: "TEST-EXTRPERSON",
    code: "EXTRPERSON",
    active: true,
    displayNameDe: "Zusatzperson",
    displayNameEn: "Additional guest",
    actionType: "increase_occupancy",
    extraPersonPricePerNight: 30,
    requiresRemainingCapacity: true,
    fulfillmentMode: "instant",
    sortOrder: 6,
  },
  "TEST-FINALCLEAN": {
    serviceId: "TEST-FINALCLEAN",
    code: "FINALCLEAN",
    active: true,
    displayNameDe: "Endreinigung",
    bookingRule: "departure_day",
    fulfillmentMode: "instant",
    sortOrder: 7,
  },
};

export const EXTENSION_CONFIG = {
  extensionNightEnabled: true,
  extensionDiscountPreArrivalOneNightGap: 15,
  extensionDiscountPreArrivalStandard: 10,
  extensionDiscountInHouseOneNightGap: 20,
  extensionDiscountInHouseStandard: 15,
  minSellableStayNights: 2,
};

export type OrderLineInput = { serviceId: string; count: number; vehiclePlates?: string[] };

export type Scenario = {
  id: string;
  title: string;
  /** Simulator environment (arrival, departure, status) read when the state is seeded. */
  env?: { arrival?: string; departure?: string; status?: string };
  mutate?: (state: SimState) => void;
  catalog?: (items: Record<string, Record<string, unknown>>) => void;
  extensionConfig?: Record<string, unknown>;
  steps: (
    | { kind: "catalog" }
    | { kind: "extension-offer" }
    | { kind: "order"; lines: OrderLineInput[] }
    | { kind: "extend" }
    | { kind: "request"; serviceId: string; quantity: number; approve: boolean }
  )[];
};

const R = "JTKQSYFX-1";

export const SCENARIOS: Scenario[] = [
  {
    id: "S01",
    title: "Standardreservierung: Katalog und Verlängerungsangebot",
    steps: [{ kind: "catalog" }, { kind: "extension-offer" }],
  },
  {
    id: "S02",
    title: "Hund bereits gebucht (aus Apaleo direkt)",
    mutate: (s) => {
      (s.services[R] ??= []).push({
        service: { id: "TEST-HUND", code: "HUND", name: "Dog fee" },
        dates: ["2027-01-12", "2027-01-13"].map((serviceDate) => ({
          serviceDate,
          count: 1,
          amount: { grossAmount: 15, currency: "EUR" },
          isMandatory: false,
        })),
      });
    },
    steps: [{ kind: "catalog" }, { kind: "order", lines: [{ serviceId: "TEST-HUND", count: 1 }] }],
  },
  {
    id: "S03",
    title: "Keine Restkapazität (5 Erwachsene + 1 Kind bei max. 6)",
    mutate: (s) => {
      const r = s.reservations[R];
      if (r) r.adults = 5;
    },
    steps: [
      { kind: "catalog" },
      { kind: "order", lines: [{ serviceId: "TEST-EXTRPERSON", count: 1 }] },
    ],
  },
  {
    id: "S04",
    title: "Apartmenttyp für Parken nicht erlaubt",
    catalog: (c) => {
      if (c["TEST-PKW"]) c["TEST-PKW"].allowedUnitGroupIds = ["TEST-OTHER"];
    },
    steps: [
      { kind: "catalog" },
      { kind: "order", lines: [{ serviceId: "TEST-PKW", count: 1, vehiclePlates: ["KN-AB 1"] }] },
    ],
  },
  {
    id: "S05",
    title: "Vergangener Aufenthalt",
    env: { arrival: "2026-10-01", departure: "2026-10-03" },
    steps: [{ kind: "catalog" }, { kind: "extension-offer" }],
  },
  {
    id: "S06",
    title: "Geänderter Apaleo-Preis (Früher Check-in 25 €)",
    mutate: (s) => {
      s.priceOverrides = { "TEST-ECI": 25 };
    },
    steps: [{ kind: "catalog" }, { kind: "order", lines: [{ serviceId: "TEST-ECI", count: 1 }] }],
  },
  {
    id: "S07",
    title: "Mehrtägige Buchung: Hund, 2 Parkplätze, Früher Check-in, 2 Zusatzpersonen",
    steps: [
      {
        kind: "order",
        lines: [
          { serviceId: "TEST-HUND", count: 1 },
          { serviceId: "TEST-PKW", count: 2, vehiclePlates: ["KN-AB 1", "FN-CD 2"] },
          { serviceId: "TEST-ECI", count: 1 },
          { serviceId: "TEST-EXTRPERSON", count: 2 },
        ],
      },
    ],
  },
  {
    id: "S08",
    title:
      "Ungültige Positionen: Menge über Kapazität, Hund ×2, Parken ohne Kennzeichen, Anfrage-Service",
    steps: [
      {
        kind: "order",
        lines: [
          { serviceId: "TEST-EXTRPERSON", count: 4 },
          { serviceId: "TEST-HUND", count: 2 },
          { serviceId: "TEST-PKW", count: 2, vehiclePlates: ["KN-AB 1"] },
          { serviceId: "TEST-BABY", count: 1 },
          { serviceId: "TEST-ECI", count: 1 },
        ],
      },
    ],
  },
  {
    id: "S09",
    title: "Verlängerung mit Hund und bestehendem Late Check-out",
    steps: [
      {
        kind: "order",
        lines: [
          { serviceId: "TEST-HUND", count: 1 },
          { serviceId: "TEST-LCO", count: 1 },
        ],
      },
      { kind: "extension-offer" },
      { kind: "extend" },
    ],
  },
  {
    id: "S10",
    title: "Verlängerung im Haus (Status InHouse, Rabatt im Haus)",
    env: { status: "InHouse" },
    steps: [{ kind: "extension-offer" }],
  },
  {
    id: "S11",
    title: "Keine Verlängerung: Folgenacht ausgebucht",
    mutate: (s) => {
      s.soldOut = ["2027-01-14"];
    },
    steps: [{ kind: "extension-offer" }],
  },
  {
    id: "S12",
    title: "Verlängerung mit Lücke von genau einer Nacht (Lückenrabatt)",
    mutate: (s) => {
      s.soldOut = ["2027-01-15"];
    },
    steps: [{ kind: "extension-offer" }],
  },
  {
    id: "S13",
    title: "Anfrage Babybett: anlegen und bestätigen",
    steps: [{ kind: "request", serviceId: "TEST-BABY", quantity: 1, approve: true }],
  },
  {
    id: "S14",
    title: "Anfrage mit zu geringer Verfügbarkeit",
    mutate: (s) => {
      s.availability = { "TEST-BABY": { "2027-01-12": 1 } };
    },
    steps: [{ kind: "request", serviceId: "TEST-BABY", quantity: 2, approve: true }],
  },
  {
    id: "S15",
    title: 'Historischer Wahrheitswert: extensionNightEnabled = "false" (Text)',
    extensionConfig: { ...EXTENSION_CONFIG, extensionNightEnabled: "false" },
    steps: [{ kind: "extension-offer" }],
  },
  {
    id: "S16",
    title: "Zusatzperson ohne gültigen Preis (Konfigurationsfehler)",
    catalog: (c) => {
      if (c["TEST-EXTRPERSON"]) c["TEST-EXTRPERSON"].extraPersonPricePerNight = "";
    },
    steps: [{ kind: "catalog" }],
  },
  {
    id: "S17",
    title: "Inaktiver Eintrag und Sortierung ohne Reihenfolge",
    catalog: (c) => {
      if (c["TEST-LCO"]) c["TEST-LCO"].active = false;
      if (c["TEST-ECI"]) delete c["TEST-ECI"].sortOrder;
    },
    steps: [{ kind: "catalog" }],
  },
  {
    id: "S18",
    title:
      "Extras-Standard: keine eigenen Sprachtexte, nur allgemeiner Text (Apaleo-Namen vorrangig)",
    catalog: (c) => {
      // Fresh Extras admin rows store the Apaleo name once in displayName/description and leave
      // the language fields empty – the usual production shape.
      for (const item of Object.values(c)) {
        item.displayName = item.serviceId === "TEST-PKW" ? "Car park" : item.displayNameDe;
        item.description = item.serviceId === "TEST-PKW" ? "Underground" : "";
        item.priceUnitLabel = item.serviceId === "TEST-PKW" ? "pro Stellplatz" : "";
        delete item.displayNameDe;
        delete item.displayNameEn;
      }
    },
    steps: [{ kind: "catalog" }],
  },
  {
    id: "S19",
    title: "Verlängerungsnacht: Mindestbelegung leer gespeichert (Extras: kein Angebot)",
    extensionConfig: { ...EXTENSION_CONFIG, minSellableStayNights: null },
    steps: [{ kind: "extension-offer" }],
  },
  {
    id: "S20",
    title: "Apartmenttyp-Beschränkung nur mit ungültigen Einträgen",
    catalog: (c) => {
      if (c["TEST-HUND"]) c["TEST-HUND"].allowedUnitGroupIds = ["kein gültiger Typ"];
    },
    steps: [{ kind: "catalog" }, { kind: "order", lines: [{ serviceId: "TEST-HUND", count: 1 }] }],
  },
  {
    id: "S21",
    title: 'Unbekannte Buchungsart ("Request") und Reihenfolge als Text/Dezimalzahl',
    catalog: (c) => {
      if (c["TEST-BABY"]) c["TEST-BABY"].fulfillmentMode = "Request";
      if (c["TEST-HUND"]) c["TEST-HUND"].sortOrder = "0";
      if (c["TEST-PKW"]) c["TEST-PKW"].sortOrder = 1.5;
    },
    steps: [{ kind: "catalog" }],
  },
];
