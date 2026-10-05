import { type TenantSeedInput } from "./seed-data";

/**
 * UNIQUE PLACES – tenant 1 (ADR 0010).
 *
 * Ids are taken over from the property registry (apps/guest/src/config/properties.ts),
 * which content scopes already reference. Apaleo ids were verified against the
 * UNIQUE PLACES Apaleo account in Phase 4. Units are seeded only where their identity is
 * known (HØV); the Apaleo test property "TEST" is a preview fixture, not master data.
 *
 * A consistency test in apps/guest keeps this file and the registry identical until the
 * app reads from the database.
 */
export const uniquePlacesSeed = {
  tenant: { id: "unique-places", slug: "unique-places", name: "UNIQUE PLACES" },
  properties: [
    {
      id: "hov",
      slug: "hov",
      displayName: "HØV",
      spokenName: "Höv",
      locationName: "Altusried",
      timezone: "Europe/Berlin",
      externalIds: { apaleo: "ALTUS" },
      units: [
        { id: "khu", slug: "khu", displayName: "KHU", externalIds: { apaleo: "ALTUS-JBK" } },
        { id: "ros", slug: "ros", displayName: "ROS", externalIds: { apaleo: "ALTUS-SWA" } },
        { id: "has", slug: "has", displayName: "HAS", externalIds: { apaleo: "ALTUS-FDX" } },
        { id: "igl", slug: "igl", displayName: "IGL", externalIds: { apaleo: "ALTUS-AXY" } },
        { id: "esl", slug: "esl", displayName: "ESL", externalIds: { apaleo: "ALTUS-AQR" } },
        { id: "fux", slug: "fux", displayName: "FUX", externalIds: { apaleo: "ALTUS-ZHN" } },
        { id: "kaz", slug: "kaz", displayName: "KAZ", externalIds: { apaleo: "ALTUS-QHO" } },
        { id: "space", slug: "space", displayName: "SPACE", externalIds: { apaleo: "ALTUS-SIQ" } },
      ],
    },
    {
      id: "huesle",
      slug: "huesle",
      displayName: "HŪSLE",
      spokenName: "Husle",
      locationName: "Bludenz",
      timezone: "Europe/Vienna",
      externalIds: { apaleo: "HUESLE" },
    },
    {
      id: "alpila",
      slug: "alpila",
      displayName: "ΛLPILΛ",
      spokenName: "Alpila",
      locationName: "Gaschurn",
      timezone: "Europe/Vienna",
      externalIds: { apaleo: "ALPILA" },
    },
    {
      id: "laeke",
      slug: "laeke",
      displayName: "LÆKE",
      spokenName: "Laeke",
      locationName: "Lindau",
      timezone: "Europe/Berlin",
      externalIds: { apaleo: "LAEKE" },
    },
  ],
} satisfies TenantSeedInput;
