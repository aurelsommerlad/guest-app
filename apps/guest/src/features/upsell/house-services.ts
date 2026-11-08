/**
 * Price and availability of own services come from the Extras app – the only service that
 * books them into Apaleo (decision 2026-11-08). STAY never maintains them a second time.
 *
 * Port: `HouseServiceSource`. Phase 2 implements it with the server-to-server Extras bridge.
 * Until then the preview source answers for test properties only, with the default gross
 * prices of the TEST property's Apaleo services – clearly marked as preview, never bookable
 * through STAY.
 */
export type HouseServiceFacts = {
  /** Gross price in cents; undefined = shown at booking time. */
  amountCents?: number;
  currency: string;
  /** What the price refers to. */
  unit: "stay" | "night" | "person-night";
  /** True while the price is a preview (no live Extras catalog yet). */
  preview: boolean;
  /** False if the Extras catalog does not offer it for this reservation right now. */
  available: boolean;
};

export interface HouseServiceSource {
  facts(
    propertyId: string,
    extrasServiceIds: readonly string[],
  ): Promise<ReadonlyMap<string, HouseServiceFacts>>;
}

/** Default gross prices of the Apaleo TEST property (read 2026-11-08). */
const TEST_PREVIEW: Readonly<Record<string, Omit<HouseServiceFacts, "preview" | "available">>> = {
  "TEST-ECI": { amountCents: 2000, currency: "EUR", unit: "stay" },
  "TEST-LCO": { amountCents: 2000, currency: "EUR", unit: "stay" },
  "TEST-HUND": { amountCents: 1500, currency: "EUR", unit: "night" },
  // Car park: no default price in Apaleo – the Extras catalog decides at booking time.
  "TEST-PKW": { currency: "EUR", unit: "night" },
  "TEST-EXTRPERSON": { amountCents: 3000, currency: "EUR", unit: "person-night" },
};

export const previewHouseServiceSource: HouseServiceSource = {
  facts(_propertyId, ids) {
    const facts = new Map<string, HouseServiceFacts>();
    for (const id of ids) {
      const known = TEST_PREVIEW[id];
      if (known) facts.set(id, { ...known, preview: true, available: true });
    }
    return Promise.resolve(facts);
  },
};
