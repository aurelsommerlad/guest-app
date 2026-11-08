/**
 * Read-only source of Apaleo services and unit groups for the catalog administration.
 * In production: the Apaleo API. Locally (APALEO_SERVICE_FIXTURES=on): the services of the
 * Apaleo TEST property as known from the Extras tests – for development and screenshots only.
 */
export type ApaleoServiceOption = {
  id: string;
  name: string;
  code: string | null;
  /** Apaleo availability mode: Daily, Arrival, Departure … */
  mode: string | null;
  defaultGrossPrice: { amount: number; currency: string } | null;
};

export type ApaleoUnitGroupOption = { id: string; name: string; maxPersons: number | null };

export type ApaleoServiceSource = {
  kind: "apaleo" | "fixture";
  listServices(apaleoPropertyId: string): Promise<ApaleoServiceOption[]>;
  listUnitGroups(apaleoPropertyId: string): Promise<ApaleoUnitGroupOption[]>;
};

const TEST_SERVICES: ApaleoServiceOption[] = [
  {
    id: "TEST-LCO",
    name: "Late Check-out",
    code: "LCO",
    mode: "Departure",
    defaultGrossPrice: { amount: 25, currency: "EUR" },
  },
  {
    id: "TEST-ECI",
    name: "Early Check-in",
    code: "ECI",
    mode: "Arrival",
    defaultGrossPrice: { amount: 25, currency: "EUR" },
  },
  {
    id: "TEST-HUND",
    name: "Hund",
    code: "HUND",
    mode: "Daily",
    defaultGrossPrice: { amount: 15, currency: "EUR" },
  },
  {
    id: "TEST-PKW",
    name: "Parkplatz",
    code: "PKW",
    mode: "Daily",
    defaultGrossPrice: { amount: 12, currency: "EUR" },
  },
  {
    id: "TEST-BABY",
    name: "Babybett",
    code: "BABY",
    mode: "Daily",
    defaultGrossPrice: { amount: 10, currency: "EUR" },
  },
  {
    id: "TEST-EXTRPERSON",
    name: "Zusatzperson",
    code: "EXTRPERSON",
    mode: "Daily",
    defaultGrossPrice: null,
  },
  {
    id: "TEST-FINALCLEAN",
    name: "Endreinigung",
    code: "FINALCLEAN",
    mode: "Departure",
    defaultGrossPrice: { amount: 60, currency: "EUR" },
  },
];

export const fixtureServiceSource: ApaleoServiceSource = {
  kind: "fixture",
  listServices: (propertyId) => Promise.resolve(propertyId === "TEST" ? TEST_SERVICES : []),
  listUnitGroups: (propertyId) =>
    Promise.resolve(
      propertyId === "TEST"
        ? [
            { id: "TEST-STUDIO", name: "Studio", maxPersons: 2 },
            { id: "TEST-APT", name: "Apartment", maxPersons: 4 },
            { id: "TEST-LOFT", name: "Loft", maxPersons: 6 },
          ]
        : [],
    ),
};
