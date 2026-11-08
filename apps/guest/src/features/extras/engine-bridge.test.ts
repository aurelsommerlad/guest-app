/**
 * M4: the STAY engine behind the guest app's bridge interface – same answers as the Extras
 * bridge for catalog, order, request, extension and "Gebucht & angefragt". In-memory Apaleo,
 * gateway "simulated"; nothing leaves the process.
 */
import { createShadowEnv, CONTEXT, type ShadowEnv } from "@up/shadow";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type BridgeSubject } from "./bridge-client";
import { createEngineBridge } from "./engine-bridge";

let env: ShadowEnv;
let n = 0;
const subject = (): BridgeSubject => ({
  tenantId: CONTEXT.tenantId,
  apaleoPropertyId: "TEST",
  reservationId: `GUEST${String(n).padStart(2, "0")}-1`,
});
function fresh(options: Parameters<ShadowEnv["reset"]>[0] = {}) {
  n += 1;
  env.reset({ reservationId: subject().reservationId, ...options });
  return createEngineBridge({
    db: env.db,
    engineFor: () => Promise.resolve({ engine: env.engine(), propertyId: CONTEXT.propertyId }),
  });
}
const key = () => crypto.randomUUID();

beforeAll(async () => {
  env = await createShadowEnv();
});
afterAll(async () => {
  await env.test.close();
});

describe("engine bridge – catalog", () => {
  it("serves services, prices in cents, limits and the extension night", async () => {
    const bridge = fresh();
    const result = await bridge.catalog(subject());
    if (result.kind !== "ok") throw new Error(result.kind);
    const dog = result.value.items.find((i) => i.serviceId === "TEST-HUND");
    expect(dog).toMatchObject({
      unitPrice: { amountCents: 1500 },
      price: { amountCents: 3000 },
      nights: 2,
      maxQuantity: 1,
      bookedCount: 0,
      fulfillment: "instant",
    });
    expect(result.value.items.find((i) => i.serviceId === "TEST-EXTRPERSON")).toMatchObject({
      actionType: "increase_occupancy",
      maxQuantity: 3,
      price: { amountCents: 6000 },
    });
    expect(result.value.extension).toMatchObject({
      currentDeparture: "2027-01-14",
      newDeparture: "2027-01-15",
      extensionPrice: { amountCents: 8910 },
      totalPrice: { amountCents: 8910 },
    });
    expect(result.value.items.find((i) => i.serviceId === "TEST-ECI")?.name).toEqual({
      de: "Früher Check-in",
      en: "Early check-in",
    });
  });

  it("is unavailable when the feature switch does not allow the subject", async () => {
    const bridge = createEngineBridge({ db: env.db, engineFor: () => Promise.resolve(undefined) });
    expect(await bridge.catalog(subject())).toEqual({ kind: "unavailable" });
    expect(
      await bridge.order(subject(), {
        idempotencyKey: key(),
        serviceId: "TEST-ECI",
        count: 1,
        expectedPrice: { amountCents: 2000, currency: "EUR" },
      }),
    ).toEqual({ kind: "unavailable" });
  });
});

describe("engine bridge – booking", () => {
  it("books with the binding price, replays a double submit, refuses a second booking", async () => {
    const bridge = fresh();
    const k = key();
    const input = {
      idempotencyKey: k,
      serviceId: "TEST-HUND",
      count: 1,
      expectedPrice: { amountCents: 3000, currency: "EUR" },
    };
    expect(await bridge.order(subject(), input)).toEqual({
      kind: "ok",
      value: {
        status: "booked",
        serviceId: "TEST-HUND",
        count: 1,
        serviceDates: ["2027-01-12", "2027-01-13"],
        price: input.expectedPrice,
      },
    });
    expect(await bridge.order(subject(), input)).toMatchObject({
      kind: "ok",
      value: { status: "booked", count: 1 },
    });
    expect(env.apaleo.state.calls.filter((c) => c.method === "SIM:book-service")).toHaveLength(1);
    expect(await bridge.order(subject(), { ...input, idempotencyKey: key() })).toEqual({
      kind: "refused",
      reason: "already_booked",
    });
    const catalog = await bridge.catalog(subject());
    expect(
      catalog.kind === "ok" && catalog.value.items.find((i) => i.serviceId === "TEST-HUND"),
    ).toMatchObject({ bookedCount: 1, maxQuantity: 0 });
  });

  it("refuses a changed price with the current price, and books nothing", async () => {
    const bridge = fresh();
    env.apaleo.state.priceOverrides["TEST-ECI"] = 25;
    expect(
      await bridge.order(subject(), {
        idempotencyKey: key(),
        serviceId: "TEST-ECI",
        count: 1,
        expectedPrice: { amountCents: 2000, currency: "EUR" },
      }),
    ).toEqual({
      kind: "refused",
      reason: "price_changed",
      price: { amountCents: 2500, currency: "EUR" },
    });
    expect(env.apaleo.state.calls.filter((c) => c.method.startsWith("SIM:"))).toEqual([]);
  });

  it("parking needs plates; additional guests respect the capacity; parallel attempts book once", async () => {
    const bridge = fresh();
    expect(
      await bridge.order(subject(), {
        idempotencyKey: key(),
        serviceId: "TEST-PKW",
        count: 1,
        expectedPrice: { amountCents: 0, currency: "EUR" },
      }),
    ).toEqual({ kind: "refused", reason: "vehicle_registration_required" });
    expect(
      await bridge.order(subject(), {
        idempotencyKey: key(),
        serviceId: "TEST-PKW",
        count: 1,
        vehiclePlates: ["KN-AB 1"],
        expectedPrice: { amountCents: 0, currency: "EUR" },
      }),
    ).toMatchObject({ kind: "ok" });
    expect(
      await bridge.order(subject(), {
        idempotencyKey: key(),
        serviceId: "TEST-EXTRPERSON",
        count: 4,
        expectedPrice: { amountCents: 24000, currency: "EUR" },
      }),
    ).toEqual({ kind: "refused", reason: "capacity_exceeded" });
    const results = await Promise.all(
      [1, 2].map(() =>
        bridge.order(subject(), {
          idempotencyKey: key(),
          serviceId: "TEST-ECI",
          count: 1,
          expectedPrice: { amountCents: 2000, currency: "EUR" },
        }),
      ),
    );
    expect(results.filter((r) => r.kind === "ok")).toHaveLength(1);
    expect(
      env.apaleo.booked(subject().reservationId).filter((s) => s.service.id === "TEST-ECI"),
    ).toHaveLength(1);
  });

  it("requests with checks when made; extends the stay with an existing Late Check-out", async () => {
    const bridge = fresh();
    const request = await bridge.request(subject(), {
      idempotencyKey: key(),
      serviceId: "TEST-BABY",
      quantity: 1,
    });
    expect(request).toMatchObject({
      kind: "ok",
      value: { status: "pending", serviceId: "TEST-BABY" },
    });
    expect(
      await bridge.request(subject(), {
        idempotencyKey: key(),
        serviceId: "TEST-BABY",
        quantity: 1,
      }),
    ).toEqual({ kind: "refused", reason: "already_requested" });
    expect(
      await bridge.order(subject(), {
        idempotencyKey: key(),
        serviceId: "TEST-LCO",
        count: 1,
        expectedPrice: { amountCents: 2000, currency: "EUR" },
      }),
    ).toMatchObject({ kind: "ok" });
    expect(
      await bridge.extend(subject(), {
        idempotencyKey: key(),
        currentDeparture: "2027-01-14",
        expectedPrice: { amountCents: 1, currency: "EUR" },
      }),
    ).toEqual({
      kind: "refused",
      reason: "price_changed",
      price: { amountCents: 8910, currency: "EUR" },
    });
    expect(
      await bridge.extend(subject(), {
        idempotencyKey: key(),
        currentDeparture: "2027-01-14",
        expectedPrice: { amountCents: 8910, currency: "EUR" },
      }),
    ).toEqual({
      kind: "ok",
      value: {
        status: "booked",
        newDeparture: "2027-01-15",
        price: { amountCents: 8910, currency: "EUR" },
      },
    });
    expect(
      await bridge.extend(subject(), {
        idempotencyKey: key(),
        currentDeparture: "2027-01-14",
        expectedPrice: { amountCents: 8910, currency: "EUR" },
      }),
    ).toEqual({ kind: "refused", reason: "not_available" });
    const lco = env.apaleo.booked(subject().reservationId).find((s) => s.service.id === "TEST-LCO");
    expect(lco?.dates.map((d) => d.serviceDate)).toEqual(["2027-01-15"]);
  });

  it('"Gebucht & angefragt": Apaleo services, additional guests, requests with status, extensions', async () => {
    const bridge = fresh();
    await bridge.order(subject(), {
      idempotencyKey: key(),
      serviceId: "TEST-ECI",
      count: 1,
      expectedPrice: { amountCents: 2000, currency: "EUR" },
    });
    await bridge.order(subject(), {
      idempotencyKey: key(),
      serviceId: "TEST-EXTRPERSON",
      count: 1,
      expectedPrice: { amountCents: 6000, currency: "EUR" },
    });
    const request = await bridge.request(subject(), {
      idempotencyKey: key(),
      serviceId: "TEST-BABY",
      quantity: 1,
    });
    if (request.kind !== "ok") throw new Error("request failed");
    await env.engine().rejectRequest(CONTEXT, request.value.requestId, env.ownerId, "intern");
    const overview = await bridge.overview(subject());
    if (overview.kind !== "ok") throw new Error(overview.kind);
    expect(overview.value.booked).toEqual([
      {
        serviceId: "TEST-ECI",
        name: { de: "Früher Check-in", en: "Early check-in" },
        count: 1,
        dates: ["2027-01-12"],
        total: { amountCents: 2000, currency: "EUR" },
      },
    ]);
    expect(overview.value.amendments).toMatchObject([
      { serviceId: "TEST-EXTRPERSON", count: 1, total: { amountCents: 6000 } },
    ]);
    expect(overview.value.requests).toMatchObject([
      {
        requestId: request.value.requestId,
        serviceId: "TEST-BABY",
        status: "rejected",
        quantity: 1,
      },
    ]);
    // The internal reason is never shown to the guest.
    expect(JSON.stringify(overview.value)).not.toContain("intern");
  });
});
