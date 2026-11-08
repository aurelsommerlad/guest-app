/**
 * Upselling Phase 2 in STAY: the Extras bridge client (tokens, error handling), the merge of
 * Extras services with STAY's editorial offers, the catalog with a live/unavailable bridge and
 * the booking service – with a fake bridge (no network) and the real repository (PGlite).
 */
import { createHmac } from "node:crypto";

import { createLogger } from "@up/core";
import {
  type Database,
  OFFER_FIXTURE_IDS,
  seedOfferFixtures,
  seedTenant,
  summarizeOfferMetrics,
  uniquePlacesSeed,
} from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findPropertyById } from "../../config/properties";
import { guestContext } from "../check-in/test-context";
import { type GuestContext } from "../guest-context/guest-context";
import { type StayJourney } from "../journey/stay-journey";
import { EXTENSION_OFFER_ID, mergeExtras } from "../upsell/extras-merge";
import { previewHouseServiceSource } from "../upsell/house-services";
import { loadOfferCatalog, type UpsellDeps } from "../upsell/upsell-service";
import { bookExtra, extendStay, requestExtra, type BookingDeps } from "./booking-service";
import {
  type BridgeResult,
  createExtrasBridge,
  type ExtrasBridge,
  type ExtrasCatalog,
  type ExtrasItem,
  type ExtrasOverview,
  signBridgeToken,
  TOKEN_LIFETIME_SECONDS,
} from "./bridge-client";

const SECRET = "test-secret-test-secret-test-secret-0123";
const subject = {
  tenantId: "unique-places",
  apaleoPropertyId: "TEST",
  reservationId: "JTKQSYFX-1",
};
const silent = createLogger({ level: "error", sink: () => undefined });

function item(overrides: Partial<ExtrasItem> & Pick<ExtrasItem, "serviceId">): ExtrasItem {
  return {
    code: null,
    name: { de: overrides.serviceId, en: overrides.serviceId },
    description: { de: "", en: "" },
    imageUrl: null,
    actionType: "service",
    bookingRule: "per_stay",
    fulfillment: "instant",
    priceUnitLabel: null,
    unitPrice: { amountCents: 2000, currency: "EUR" },
    nights: 1,
    price: { amountCents: 2000, currency: "EUR" },
    serviceDates: ["2027-01-12"],
    restricted: false,
    maxQuantity: null,
    maxOnePerReservation: false,
    bookedCount: 0,
    requiresVehicleRegistration: false,
    existingVehicleRegistration: null,
    ...overrides,
  };
}

const catalog: ExtrasCatalog = {
  pastStay: false,
  arrival: "2027-01-12",
  departure: "2027-01-14",
  items: [
    item({ serviceId: "TEST-ECI", code: "ECI", bookedCount: 1 }),
    item({
      serviceId: "TEST-HUND",
      code: "HUND",
      bookingRule: "per_night",
      nights: 2,
      unitPrice: { amountCents: 1500, currency: "EUR" },
      maxQuantity: 1,
      maxOnePerReservation: true,
    }),
    item({
      serviceId: "TEST-PKW",
      code: "PKW",
      bookingRule: "per_night",
      nights: 2,
      unitPrice: { amountCents: 0, currency: "EUR" },
      requiresVehicleRegistration: true,
      existingVehicleRegistration: "LI-UP 1",
    }),
    item({
      serviceId: "TEST-BABY",
      code: "BABY",
      fulfillment: "request",
      name: { de: "Babybett", en: "Baby cot" },
    }),
    item({
      serviceId: "TEST-EXTRPERSON",
      actionType: "increase_occupancy",
      bookingRule: "per_person_per_night",
      nights: 2,
      unitPrice: { amountCents: 3000, currency: "EUR" },
      maxQuantity: 3,
    }),
    item({ serviceId: "TEST-SECRET", restricted: true }),
  ],
  extension: {
    currentDeparture: "2027-01-14",
    newDeparture: "2027-01-15",
    phase: "before_arrival",
    discountPercent: 10,
    extensionPrice: { amountCents: 8910, currency: "EUR" },
    extras: [],
    cityTaxCents: null,
    totalPrice: { amountCents: 8910, currency: "EUR" },
  },
};

const overview: ExtrasOverview = {
  amendments: [
    {
      serviceId: "TEST-EXTRPERSON",
      name: { de: "Zusätzliche Person", en: "Additional guest" },
      count: 2,
      total: { amountCents: 12000, currency: "EUR" },
      createdAt: "2026-11-08T10:00:00Z",
    },
  ],
  booked: [
    {
      serviceId: "TEST-ECI",
      name: { de: "Früher Check-in", en: "Early check-in" },
      count: 1,
      dates: ["2027-01-12"],
      total: { amountCents: 2000, currency: "EUR" },
    },
  ],
  requests: [
    {
      requestId: "r1",
      serviceId: "TEST-BABY",
      serviceName: "Babybett",
      quantity: 1,
      status: "pending",
      createdAt: "2026-11-08T10:00:00Z",
      decidedAt: null,
    },
  ],
  extensions: [],
};

describe("bridge client", () => {
  it("signs short-lived HS256 tokens bound to tenant, property and reservation", () => {
    const now = new Date("2026-11-08T10:00:00Z");
    const token = signBridgeToken(subject, "write", SECRET, now, "jti-0123456789abcdef");
    const [header, payload, signature] = token.split(".");
    expect(createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url")).toBe(
      signature,
    );
    const claims = JSON.parse(Buffer.from(payload ?? "", "base64url").toString()) as Record<
      string,
      unknown
    >;
    expect(claims).toEqual({
      iss: "stay",
      aud: "extras-stay-bridge",
      sub: "JTKQSYFX-1",
      tid: "unique-places",
      pid: "TEST",
      scope: "write",
      jti: "jti-0123456789abcdef",
      iat: 1794132000,
      exp: 1794132000 + TOKEN_LIFETIME_SECONDS,
    });
    // A new token id per call.
    expect(signBridgeToken(subject, "read", SECRET, now)).not.toBe(
      signBridgeToken(subject, "read", SECRET, now),
    );
  });

  it("sends the token only in the Authorization header, never in the URL", async () => {
    const seen: { url: string; auth: string | null; body: string }[] = [];
    const bridge = createExtrasBridge({
      baseUrl: "https://extras.test/",
      secret: SECRET,
      fetch: (url, init) => {
        seen.push({
          url: url instanceof Request ? url.url : url.toString(),
          auth: new Headers(init?.headers).get("authorization"),
          body: typeof init?.body === "string" ? init.body : "",
        });
        return Promise.resolve(Response.json(catalog));
      },
    });
    const result = await bridge.catalog(subject);
    expect(result.kind).toBe("ok");
    expect(seen[0]?.url).toBe("https://extras.test/api/stay/v1/catalog");
    expect(seen[0]?.auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(seen[0]?.url).not.toMatch(/JTKQSYFX|Mustermann/);
  });

  it("maps refusals, server errors, timeouts and unexpected answers – never guesses", async () => {
    const answer = (response: Response | Error) =>
      createExtrasBridge({
        baseUrl: "https://extras.test",
        secret: SECRET,
        fetch: () =>
          response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
      });
    const order = {
      idempotencyKey: crypto.randomUUID(),
      serviceId: "TEST-ECI",
      count: 1,
      expectedPrice: { amountCents: 2000, currency: "EUR" },
    };
    expect(
      await answer(
        Response.json(
          { error: "price_changed", price: { amountCents: 2500, currency: "EUR" } },
          { status: 409 },
        ),
      ).order(subject, order),
    ).toEqual({
      kind: "refused",
      reason: "price_changed",
      price: { amountCents: 2500, currency: "EUR" },
    });
    expect(
      await answer(Response.json({ error: "upstream_unavailable" }, { status: 502 })).order(
        subject,
        order,
      ),
    ).toEqual({ kind: "unavailable" });
    expect(
      await answer(Response.json({ error: "unauthorized" }, { status: 401 })).order(subject, order),
    ).toEqual({ kind: "unavailable" });
    expect(await answer(new DOMException("timeout", "TimeoutError")).order(subject, order)).toEqual(
      { kind: "unavailable" },
    );
    expect(await answer(Response.json({ items: "nope" })).catalog(subject)).toEqual({
      kind: "unavailable",
    });
  });
});

describe("merge with STAY's editorial offers", () => {
  it("uses editorial content where it exists, Extras' own text elsewhere, and Extras' states", () => {
    const merged = mergeExtras({
      tenantId: "unique-places",
      propertyId: "test-run",
      locale: "de",
      editorial: [],
      catalog,
      overview,
    });
    const ids = merged.offers.map((offer) => offer.id);
    expect(ids).toEqual([
      "extras-TEST-ECI",
      "extras-TEST-HUND",
      "extras-TEST-PKW",
      "extras-TEST-BABY",
      "extras-TEST-EXTRPERSON",
      EXTENSION_OFFER_ID,
    ]);
    expect(ids).not.toContain("extras-TEST-SECRET"); // restricted for this apartment type
    expect(merged.taken).toEqual(new Set(["extras-TEST-ECI", "extras-TEST-BABY"]));
    const dog = merged.live.get("extras-TEST-HUND");
    expect(dog?.price).toEqual({
      kind: "amount",
      amountCents: 1500,
      currency: "EUR",
      per: "night",
      from: false,
    });
    expect(dog?.booking).toMatchObject({
      kind: "service",
      maxQuantity: 1,
      quantity: false,
      nights: 2,
      state: "open",
    });
    expect(merged.live.get("extras-TEST-PKW")?.booking).toMatchObject({
      requiresPlate: true,
      existingPlate: "LI-UP 1",
      quantity: true,
    });
    expect(merged.live.get("extras-TEST-EXTRPERSON")?.price).toMatchObject({ per: "person-night" });
    expect(merged.live.get("extras-TEST-BABY")?.booking).toMatchObject({
      fulfillment: "request",
      state: "requested",
    });
    expect(merged.live.get(EXTENSION_OFFER_ID)?.booking).toMatchObject({
      kind: "extension",
      totalCents: 8910,
    });
    expect(merged.booked.map((entry) => [entry.title, entry.status])).toEqual([
      ["Früher Check-in", "booked"],
      ["Zusätzliche Person (2)", "booked"],
      ["Babybett", "pending"],
    ]);
  });

  it("keeps no price of its own when Extras has none", () => {
    const merged = mergeExtras({
      tenantId: "unique-places",
      propertyId: "test-run",
      locale: "en",
      editorial: [],
      catalog: {
        ...catalog,
        extension: null,
        items: [item({ serviceId: "TEST-X", unitPrice: null, price: null })],
      },
      overview: undefined,
    });
    expect(merged.live.get("extras-TEST-X")?.price).toEqual({ kind: "at-booking" });
    expect(merged.live.get("extras-TEST-X")?.booking).toMatchObject({ unitCents: null });
  });
});

/** Fake bridge: answers from fixed data, records the calls. */
function fakeBridge(
  options: {
    catalog?: BridgeResult<ExtrasCatalog>;
    orderResult?: Awaited<ReturnType<ExtrasBridge["order"]>>;
  } = {},
) {
  const calls: string[] = [];
  const bridge: ExtrasBridge = {
    catalog: () => {
      calls.push("catalog");
      return Promise.resolve(options.catalog ?? { kind: "ok", value: catalog });
    },
    overview: () => {
      calls.push("overview");
      return Promise.resolve({ kind: "ok", value: overview });
    },
    order: (_subject, input) => {
      calls.push(`order:${input.serviceId}`);
      return Promise.resolve(
        options.orderResult ?? {
          kind: "ok",
          value: {
            status: "booked",
            serviceId: input.serviceId,
            count: input.count,
            serviceDates: ["2027-01-12", "2027-01-13"],
            price: input.expectedPrice,
          },
        },
      );
    },
    request: (_subject, input) => {
      calls.push(`request:${input.serviceId}`);
      return Promise.resolve({
        kind: "ok",
        value: { status: "pending", requestId: "r2", serviceId: input.serviceId },
      });
    },
    extend: () => {
      calls.push("extend");
      return Promise.resolve({ kind: "refused", reason: "not_available" });
    },
  };
  return { bridge, calls };
}

let db: Database;
let client: TestDatabase["client"];
let close: () => Promise<void>;

function testRunContext(overrides: Partial<GuestContext> = {}): GuestContext {
  const property = findPropertyById("test-run");
  if (!property) throw new Error("test-run missing");
  return guestContext({
    propertyId: "test-run",
    property,
    externalReservationId: "JTKQSYFX-1",
    ...overrides,
  });
}

const journey = {
  journey: { phase: "before-arrival" },
  arrivalDate: "2027-01-12",
  window: {
    checkInAt: "2027-01-12T16:00:00+01:00",
    checkOutAt: "2027-01-14T10:00:00+01:00",
    timeZone: "Europe/Berlin",
  },
} as unknown as StayJourney;

beforeAll(async () => {
  ({ db, client, close } = await createTestDatabase());
  await seedTenant(db, uniquePlacesSeed);
  await client.query(
    `INSERT INTO properties (id, tenant_id, slug, display_name, spoken_name, location_name, timezone)
     VALUES ('test-run', 'unique-places', 'test-run', 'Test run', 'Test run', 'Testumgebung', 'Europe/Berlin')
     ON CONFLICT DO NOTHING`,
  );
  await seedOfferFixtures(db, { tenantId: "unique-places" }, { withImages: false });
});

afterAll(async () => {
  await close();
});

describe("offer catalog with the bridge", () => {
  const deps = (extras: ExtrasBridge | undefined): UpsellDeps => ({
    db,
    logger: silent,
    houseServices: previewHouseServiceSource,
    ...(extras ? { extras } : {}),
  });

  it("lists own services from Extras with STAY's editorial content and binding prices", async () => {
    const { bridge } = fakeBridge();
    const result = await loadOfferCatalog(deps(bridge), testRunContext(), journey, "de");
    expect(result?.house).toBe("live");
    const stay = result?.offers.filter((offer) => offer.chapter === "stay") ?? [];
    // Early check-in is booked, the cot requested: on their pages, not in the list.
    expect(stay.map((offer) => offer.id)).toEqual([
      OFFER_FIXTURE_IDS.dog,
      OFFER_FIXTURE_IDS.parking,
      OFFER_FIXTURE_IDS.extraPerson,
      EXTENSION_OFFER_ID,
    ]);
    const dog = stay.find((offer) => offer.id === OFFER_FIXTURE_IDS.dog);
    expect(dog).toMatchObject({
      href: "/v2/services/mit-hund",
      pricePreview: false,
      price: { amountCents: 1500, per: "night" },
    });
    expect(
      result?.all.find((offer) => offer.id === OFFER_FIXTURE_IDS.earlyCheckIn)?.booking,
    ).toMatchObject({ state: "booked" });
    expect(result?.all.find((offer) => offer.id === "extras-TEST-BABY")?.booking).toMatchObject({
      state: "requested",
    });
    expect(result?.booked.map((entry) => entry.status)).toEqual(["booked", "booked", "pending"]);
    expect(result?.booked[0]?.href).toBe("/v2/services/frueher-einchecken");
    // Partner offers stay as they are.
    expect(result?.offers.some((offer) => offer.kind === "partner")).toBe(true);
  });

  it("shows no own services (and no guessed prices) while the bridge is unavailable", async () => {
    const { bridge } = fakeBridge({ catalog: { kind: "unavailable" } });
    const result = await loadOfferCatalog(deps(bridge), testRunContext(), journey, "de");
    expect(result?.house).toBe("unavailable");
    expect(result?.offers.every((offer) => offer.kind === "partner")).toBe(true);
  });

  it("keeps Phase 1 (link to the Extras app) where the property has not opted in", async () => {
    const { bridge, calls } = fakeBridge();
    const property = findPropertyById("test-run");
    if (!property) throw new Error("missing");
    const withoutBridge = { ...property, extras: undefined };
    const result = await loadOfferCatalog(
      deps(bridge),
      testRunContext({ property: withoutBridge }),
      journey,
      "de",
    );
    expect(result?.house).toBe("preview");
    expect(calls).toEqual([]);
  });
});

describe("booking service", () => {
  const bookingDeps = (extras: ExtrasBridge): BookingDeps => ({
    db,
    logger: silent,
    extras,
    now: () => new Date("2026-11-08T10:00:00Z"),
    timeZone: "Europe/Berlin",
  });

  it("refuses invalid input before calling Extras", async () => {
    const { bridge, calls } = fakeBridge();
    for (const input of [
      null,
      {
        idempotencyKey: "x",
        serviceId: "TEST-HUND",
        count: 1,
        expectedPrice: { amountCents: 3000, currency: "EUR" },
      },
      {
        idempotencyKey: crypto.randomUUID(),
        serviceId: "TEST HUND",
        count: 1,
        expectedPrice: { amountCents: 3000, currency: "EUR" },
      },
      {
        idempotencyKey: crypto.randomUUID(),
        serviceId: "TEST-HUND",
        count: 0,
        expectedPrice: { amountCents: 3000, currency: "EUR" },
      },
      { idempotencyKey: crypto.randomUUID(), serviceId: "TEST-HUND", count: 1 },
    ]) {
      expect(await bookExtra(bookingDeps(bridge), testRunContext(), input)).toEqual({
        kind: "error",
        reason: "invalid",
      });
    }
    expect(calls).toEqual([]);
  });

  it("books through the bridge and counts the attributable revenue (daily totals only)", async () => {
    const { bridge, calls } = fakeBridge();
    const outcome = await bookExtra(bookingDeps(bridge), testRunContext(), {
      idempotencyKey: crypto.randomUUID(),
      serviceId: "TEST-HUND",
      count: 1,
      expectedPrice: { amountCents: 3000, currency: "EUR" },
    });
    expect(outcome).toEqual({
      kind: "booked",
      serviceDates: ["2027-01-12", "2027-01-13"],
      amountCents: 3000,
      currency: "EUR",
    });
    expect(calls).toEqual(["order:TEST-HUND"]);
    const rows = await summarizeOfferMetrics(
      db,
      { tenantId: "unique-places" },
      { from: "2026-11-08", to: "2026-11-08", propertyId: "test-run" },
    );
    expect(rows.find((row) => row.offerId === OFFER_FIXTURE_IDS.dog)).toMatchObject({
      bookings: 1,
      revenueCents: 3000,
    });
  });

  it("passes refusals and requests through, never on another reservation", async () => {
    const { bridge } = fakeBridge({ orderResult: { kind: "refused", reason: "already_booked" } });
    expect(
      await bookExtra(bookingDeps(bridge), testRunContext(), {
        idempotencyKey: crypto.randomUUID(),
        serviceId: "TEST-ECI",
        count: 1,
        expectedPrice: { amountCents: 2000, currency: "EUR" },
      }),
    ).toEqual({ kind: "error", reason: "already_booked" });
    expect(
      await requestExtra(bookingDeps(bridge), testRunContext(), {
        idempotencyKey: crypto.randomUUID(),
        serviceId: "TEST-BABY",
        quantity: 1,
      }),
    ).toEqual({ kind: "requested" });
    expect(
      await extendStay(bookingDeps(bridge), testRunContext(), {
        idempotencyKey: crypto.randomUUID(),
        currentDeparture: "2027-01-14",
        expectedPrice: { amountCents: 8910, currency: "EUR" },
      }),
    ).toEqual({ kind: "error", reason: "not_available" });
    // Property without the bridge: nothing is sent.
    const hov = guestContext();
    expect(
      await requestExtra(bookingDeps(bridge), hov, {
        idempotencyKey: crypto.randomUUID(),
        serviceId: "TEST-BABY",
        quantity: 1,
      }),
    ).toEqual({ kind: "error", reason: "unavailable" });
  });

  it("brakes repeated attempts per stay", async () => {
    const { bridge } = fakeBridge({ orderResult: { kind: "refused", reason: "not_available" } });
    const context = testRunContext({ externalReservationId: "RATELIMIT-1" });
    let last;
    for (let i = 0; i < 31; i++) {
      last = await requestExtra(bookingDeps(bridge), context, {
        idempotencyKey: crypto.randomUUID(),
        serviceId: "TEST-BABY",
        quantity: 1,
      });
    }
    expect(last).toEqual({ kind: "error", reason: "rate_limited" });
  });
});
