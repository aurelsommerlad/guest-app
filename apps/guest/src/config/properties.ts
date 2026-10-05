/**
 * Property registry: our properties and their identity in the PMS.
 *
 * Central, typed configuration until our own database exists. Each entry maps the
 * stable PMS ids (Apaleo property id, unit ids) to our internal ids and the
 * branded presentation – never derived from PMS display names.
 *
 * Migration: this becomes the tables `properties`, `units` and `pms_mappings`
 * (tenant_id, provider, external_property_id → property_id, external_unit_id → unit_id).
 *
 * Apaleo ids verified against the UNIQUE PLACES Apaleo account (Phase 4).
 */

export type RegisteredUnit = {
  /** Internal id, e.g. "ros" – used for content scopes. */
  id: string;
  /** Display name in the guest app, e.g. "ROS". */
  name: string;
  /** Unit id in the PMS, e.g. Apaleo "ALTUS-SWA" ("ROS No. 2"). */
  externalId: string;
};

export type RegisteredProperty = {
  id: string;
  tenantId: string;
  /** Branded display name exactly as written. */
  name: string;
  /** Pronounceable name for screen readers. */
  spokenName: string;
  location: string;
  /** IANA time zone (matches the Apaleo property's timeZone). */
  timeZone: string;
  pms: { provider: "apaleo"; propertyId: string };
  /** Test properties are never resolved in production. */
  testOnly?: boolean;
  units: readonly RegisteredUnit[];
};

const tenantId = "unique-places";

export const propertyRegistry: readonly RegisteredProperty[] = [
  {
    id: "hov",
    tenantId,
    name: "HØV",
    spokenName: "Höv",
    location: "Altusried",
    timeZone: "Europe/Berlin",
    pms: { provider: "apaleo", propertyId: "ALTUS" },
    units: [
      { id: "khu", name: "KHU", externalId: "ALTUS-JBK" },
      { id: "ros", name: "ROS", externalId: "ALTUS-SWA" },
      { id: "has", name: "HAS", externalId: "ALTUS-FDX" },
      { id: "igl", name: "IGL", externalId: "ALTUS-AXY" },
      { id: "esl", name: "ESL", externalId: "ALTUS-AQR" },
      { id: "fux", name: "FUX", externalId: "ALTUS-ZHN" },
      { id: "kaz", name: "KAZ", externalId: "ALTUS-QHO" },
      { id: "space", name: "SPACE", externalId: "ALTUS-SIQ" },
    ],
  },
  {
    id: "huesle",
    tenantId,
    name: "HŪSLE",
    spokenName: "Husle",
    location: "Bludenz",
    timeZone: "Europe/Vienna",
    pms: { provider: "apaleo", propertyId: "HUESLE" },
    units: [], // to be added when HŪSLE is onboarded
  },
  {
    id: "alpila",
    tenantId,
    name: "ΛLPILΛ",
    spokenName: "Alpila",
    location: "Gaschurn",
    timeZone: "Europe/Vienna",
    pms: { provider: "apaleo", propertyId: "ALPILA" },
    units: [],
  },
  {
    id: "laeke",
    tenantId,
    name: "LÆKE",
    spokenName: "Laeke",
    location: "Lindau",
    timeZone: "Europe/Berlin",
    pms: { provider: "apaleo", propertyId: "LAEKE" },
    units: [],
  },
  {
    // Apaleo test property ("Test run") for preview reservations.
    id: "test-run",
    tenantId,
    name: "TEST",
    spokenName: "Test",
    location: "Testumgebung",
    timeZone: "Europe/Berlin",
    pms: { provider: "apaleo", propertyId: "TEST" },
    testOnly: true,
    units: [
      { id: "test-ap-1", name: "Ap. 1", externalId: "TEST-ZHF" },
      { id: "test-ap-2", name: "Ap. 2", externalId: "TEST-WEZ" },
    ],
  },
];

export function findPropertyById(id: string): RegisteredProperty | undefined {
  return propertyRegistry.find((property) => property.id === id);
}

export function findPropertyByPmsId(
  provider: string,
  externalPropertyId: string,
): RegisteredProperty | undefined {
  return propertyRegistry.find(
    (property) =>
      property.pms.provider === provider && property.pms.propertyId === externalPropertyId,
  );
}
