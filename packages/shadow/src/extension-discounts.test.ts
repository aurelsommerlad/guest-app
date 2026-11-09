/**
 * The four extension discounts end to end: stored STAY settings (property_service_settings) →
 * engine → offer. Distinct values per field so a swapped column or phase would show at once.
 * Phase "in_house" = status InHouse; gap 1 = the night after the extra one is sold out.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays } from "./apaleo-double";
import { CONTEXT, createShadowEnv, PROPERTY, type ShadowEnv, TENANT } from "./test-env";

let env: ShadowEnv;
let n = 0;

beforeAll(async () => {
  env = await createShadowEnv();
  await env.test.client.query(
    `UPDATE property_service_settings
        SET discount_pre_arrival_one_night_gap = 11, discount_pre_arrival_standard = 12,
            discount_in_house_one_night_gap = 13, discount_in_house_standard = 14,
            min_sellable_stay_nights = 2
      WHERE tenant_id = $1 AND property_id = $2`,
    [TENANT, PROPERTY],
  );
});
afterAll(async () => {
  await env.test.close();
});

async function offerFor(options: { status?: string; soldOut?: string[] }) {
  n += 1;
  const reservationId = `DISC${String(n).padStart(2, "0")}-1`;
  // Apaleo status InHouse decides the phase (Extras: determineStayExtensionPhase).
  const inHouse = options.status === "InHouse";
  env.reset({ reservationId, ...(inHouse ? { status: "InHouse" } : {}) });
  env.apaleo.state.soldOut = options.soldOut ?? [];
  return { offer: await env.engine().getStayExtensionOffer(CONTEXT, reservationId), inHouse };
}

describe("extension night – all four discount settings", () => {
  const avg = 99; // average nightly rate of the double's reservation
  const price = (percent: number) => Math.round(avg * (1 - percent / 100) * 100) / 100;

  it("before arrival, remaining gap sellable → pre-arrival standard (12 %)", async () => {
    const { offer } = await offerFor({});
    expect(offer).toMatchObject({ phase: "before_arrival", discountPercent: 12 });
    expect(offer?.extensionPrice.amount).toBe(price(12));
    expect(offer?.averageNightlyRate.amount).toBe(avg);
  });

  it("before arrival, exactly one free night → pre-arrival one-night gap (11 %)", async () => {
    const { offer } = await offerFor({ soldOut: [addDays("2027-01-14", 1)] });
    expect(offer).toMatchObject({ phase: "before_arrival", gap: 1, discountPercent: 11 });
    expect(offer?.extensionPrice.amount).toBe(price(11));
  });

  it("in house, remaining gap sellable → in-house standard (14 %)", async () => {
    const { offer } = await offerFor({ status: "InHouse" });
    expect(offer).toMatchObject({ phase: "in_house", discountPercent: 14 });
    expect(offer?.extensionPrice.amount).toBe(price(14));
  });

  it("in house, exactly one free night → in-house one-night gap (13 %)", async () => {
    const { offer } = await offerFor({ status: "InHouse", soldOut: [addDays("2027-01-14", 1)] });
    expect(offer).toMatchObject({ phase: "in_house", gap: 1, discountPercent: 13 });
    expect(offer?.extensionPrice.amount).toBe(price(13));
  });

  it("a gap of exactly the minimum (2) would leave an unsellable night → no offer", async () => {
    const { offer } = await offerFor({ soldOut: [addDays("2027-01-14", 2)] });
    expect(offer).toBeNull();
  });
});
