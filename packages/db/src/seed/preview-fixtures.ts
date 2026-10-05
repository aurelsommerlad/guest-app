import { type TenantSeedInput } from "./seed-data";
import { uniquePlacesSeed } from "./unique-places";

/**
 * Preview fixtures (ADR 0011): the Apaleo test property "TEST" of the UNIQUE PLACES
 * account, so guest access can be tried end to end on local/staging with test
 * reservations. Not master data – the CLI refuses to seed it into production.
 * Ids match the code registry (apps/guest/src/config/properties.ts, `testOnly`).
 */
export const previewFixturesSeed = {
  tenant: uniquePlacesSeed.tenant,
  properties: [
    {
      id: "test-run",
      slug: "test-run",
      displayName: "TEST",
      spokenName: "Test",
      locationName: "Testumgebung",
      timezone: "Europe/Berlin",
      externalIds: { apaleo: "TEST" },
      units: [
        {
          id: "test-ap-1",
          slug: "test-ap-1",
          displayName: "Ap. 1",
          externalIds: { apaleo: "TEST-ZHF" },
        },
        {
          id: "test-ap-2",
          slug: "test-ap-2",
          displayName: "Ap. 2",
          externalIds: { apaleo: "TEST-WEZ" },
        },
      ],
    },
  ],
} satisfies TenantSeedInput;
