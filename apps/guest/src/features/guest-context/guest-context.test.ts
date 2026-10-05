import {
  computeAccessWindow,
  createLogger,
  generateSecret,
  hashSecret,
  type GuideSection,
  type PmsProvider,
  type PmsReservation,
  selectGuideSections,
} from "@up/core";
import {
  createGuestAccess,
  type Database,
  revokeGuestAccessForReservation,
  seedTenant,
  uniquePlacesSeed,
} from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { MockPmsProvider } from "@up/integrations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockPms } from "../../mocks/stay/mock-pms";
import { MOCK_NOW, MOCK_RESERVATION_ID } from "../../mocks/stay/mock-stay";
import {
  type CurrentGuestAccess,
  enterWithLinkToken,
  type GuestAccessDeps,
  resolveGuestSession,
} from "../guest-access/guest-access-service";
import { guideContextOf } from "../guide/guide-context";
import {
  type GuestContext,
  type GuestContextInput,
  resolveGuestContext,
  stayWindowOf,
} from "./guest-context";

const NOW = new Date("2026-10-10T12:00:00+02:00");
const logger = createLogger({ sink: () => undefined });

/** The real Apaleo test case: IHESZZFV-1 in HØV, unit ESL (Apaleo ALTUS-AQR). */
const eslReservation: PmsReservation = {
  provider: "apaleo",
  externalId: "IHESZZFV-1",
  status: "confirmed",
  arrivalAt: "2026-10-08T16:00:00+02:00",
  departureAt: "2026-10-13T10:00:00+02:00",
  externalPropertyId: "ALTUS",
  externalUnitId: "ALTUS-AQR",
  primaryGuest: { firstName: "Alex" },
};

const eslAccess: CurrentGuestAccess = {
  guestAccessId: "00000000-0000-4000-8000-000000000001",
  tenantId: "unique-places",
  propertyId: "hov",
  unitId: "esl",
  reservationProvider: "apaleo",
  externalReservationId: "IHESZZFV-1",
};

function input(overrides: Partial<GuestContextInput> = {}): GuestContextInput {
  const apaleo = new MockPmsProvider([eslReservation]);
  return {
    access: eslAccess,
    allowPreview: false,
    preview: () => ({ provider: "mock", reservationId: MOCK_RESERVATION_ID, now: MOCK_NOW }),
    pmsFor: (provider) => (provider === "apaleo" ? apaleo : createMockPms(NOW)),
    now: NOW,
    sourceOptions: { allowTestProperties: true, cardsFor: () => [] },
    logger,
    ...overrides,
  };
}

async function contextOf(overrides: Partial<GuestContextInput> = {}): Promise<GuestContext> {
  const result = await resolveGuestContext(input(overrides));
  if (result.kind !== "context") throw new Error(`expected a context, got ${result.kind}`);
  return result.context;
}

describe("central guest context", () => {
  it("resolves a HØV / ESL session to hov/esl with the loaded reservation", async () => {
    const context = await contextOf();
    expect(context).toMatchObject({
      mode: "guest",
      tenantId: "unique-places",
      propertyId: "hov",
      unitId: "esl",
      reservationProvider: "apaleo",
      externalReservationId: "IHESZZFV-1",
      guestAccessId: eslAccess.guestAccessId,
      now: NOW,
    });
    expect(context.property.name).toBe("HØV");
    expect(context.reservation.status).toBe("loaded");
    if (context.reservation.status === "loaded") {
      expect(context.reservation.source.unit).toEqual({ id: "esl", name: "ESL" });
      expect(context.reservation.source.guest.firstName).toBe("Alex");
    }
    expect(stayWindowOf(context)).toEqual({
      checkInAt: "2026-10-08T16:00:00+02:00",
      checkOutAt: "2026-10-13T10:00:00+02:00",
    });
  });

  it("follows the live unit of the reservation", async () => {
    const moved = { ...eslReservation, externalUnitId: "ALTUS-SWA" };
    const context = await contextOf({ pmsFor: () => new MockPmsProvider([moved]) });
    expect(context.unitId).toBe("ros");
  });

  it("keeps property and stored unit when the PMS is unavailable", async () => {
    const down: PmsProvider = {
      name: "down",
      getReservation: () => Promise.reject(new Error("down")),
      findReservationsByBookingReference: () => Promise.resolve([]),
    };
    const context = await contextOf({ pmsFor: () => down });
    expect(context).toMatchObject({ propertyId: "hov", unitId: "esl" });
    expect(context.reservation).toEqual({ status: "unavailable" });
    expect(stayWindowOf(context)).toBeUndefined();
  });

  it("treats canceled or mismatching reservations as invalid access", async () => {
    const canceled = { ...eslReservation, status: "canceled" as const };
    expect(
      await resolveGuestContext(input({ pmsFor: () => new MockPmsProvider([canceled]) })),
    ).toEqual({
      kind: "access-invalid",
    });
    expect(
      await resolveGuestContext(input({ access: { ...eslAccess, propertyId: "huesle" } })),
    ).toEqual({
      kind: "access-invalid",
    });
    expect(
      await resolveGuestContext(input({ access: { ...eslAccess, tenantId: "other" } })),
    ).toEqual({
      kind: "access-invalid",
    });
  });

  it("never falls back to the mock preview without a session in secured mode or production", async () => {
    const preview = vi.fn(() => ({
      provider: "mock" as const,
      reservationId: MOCK_RESERVATION_ID,
      now: MOCK_NOW,
    }));
    expect(
      await resolveGuestContext(input({ access: undefined, allowPreview: false, preview })),
    ).toEqual({
      kind: "unauthenticated",
    });
    expect(preview).not.toHaveBeenCalled();
  });

  it("keeps the development preview (mock HØV / ROS) when allowed", async () => {
    const context = await contextOf({ access: undefined, allowPreview: true });
    expect(context).toMatchObject({
      mode: "preview",
      tenantId: "unique-places",
      propertyId: "hov",
      unitId: "ros",
      reservationProvider: "mock",
      externalReservationId: MOCK_RESERVATION_ID,
      now: MOCK_NOW,
    });
    expect(context.guestAccessId).toBeUndefined();
  });

  it("prefers a valid session over the preview", async () => {
    const context = await contextOf({ allowPreview: true });
    expect(context.mode).toBe("guest");
    expect(context.unitId).toBe("esl");
  });
});

describe("GUIDE uses the central context", () => {
  const section = (id: string, scope: GuideSection["scope"]): GuideSection => ({
    id,
    tenantId: "unique-places",
    key: id,
    scope,
    status: "published",
    slug: { de: id, en: id },
    title: { de: id, en: id },
    shortDescription: { de: id, en: id },
    icon: "info",
    sortOrder: 1,
    blocks: [],
  });
  const sections = [
    section("house-rules", { level: "property", propertyId: "hov" }),
    section("esl-sauna", { level: "unit", propertyId: "hov", unitId: "esl" }),
    section("ros-fireplace", { level: "unit", propertyId: "hov", unitId: "ros" }),
    section("huesle-only", { level: "property", propertyId: "huesle" }),
  ];

  it("selects HØV property content plus ESL – not ROS", async () => {
    const guide = guideContextOf(await contextOf());
    expect(guide).toMatchObject({ tenantId: "unique-places", propertyId: "hov", unitId: "esl" });
    expect(selectGuideSections(sections, guide).map((item) => item.id)).toEqual([
      "house-rules",
      "esl-sauna",
    ]);
  });

  it("selects ROS content in the development preview", async () => {
    const guide = guideContextOf(await contextOf({ access: undefined, allowPreview: true }));
    expect(selectGuideSections(sections, guide).map((item) => item.id)).toEqual([
      "house-rules",
      "ros-fireplace",
    ]);
  });
});

describe("session → context across requests", () => {
  let test: TestDatabase;
  let db: Database;
  let deps: GuestAccessDeps;

  beforeEach(async () => {
    test = await createTestDatabase();
    db = test.db;
    await seedTenant(db, uniquePlacesSeed);
    deps = { db, logger, now: () => NOW };
  });

  afterEach(async () => {
    await test.close();
  });

  async function eslSession() {
    const token = generateSecret();
    await createGuestAccess(
      db,
      { tenantId: "unique-places" },
      {
        propertyId: "hov",
        unitId: "esl",
        reservationProvider: "apaleo",
        externalReservationId: "IHESZZFV-1",
        tokenHash: hashSecret(token),
        ...computeAccessWindow(eslReservation),
      },
    );
    const grant = await enterWithLinkToken(deps, token);
    if (!grant) throw new Error("no session");
    return grant.secret;
  }

  it("resolves the same context on every request of the session (STAY → GUIDE → EXPLORE)", async () => {
    const secret = await eslSession();
    const contexts = [];
    for (let request = 0; request < 3; request++) {
      // Each page request: cookie → session → access → context.
      const access = await resolveGuestSession(deps, secret);
      contexts.push(await resolveGuestContext(input({ access })));
    }
    for (const result of contexts) {
      expect(result).toMatchObject({
        kind: "context",
        context: { propertyId: "hov", unitId: "esl" },
      });
    }
  });

  it("does not accept a revoked or unknown session – and never shows the mock instead", async () => {
    const secret = await eslSession();
    await revokeGuestAccessForReservation(
      db,
      { tenantId: "unique-places" },
      { provider: "apaleo", externalReservationId: "IHESZZFV-1" },
      NOW,
    );
    for (const cookie of [secret, generateSecret(), "garbage", undefined]) {
      const access = await resolveGuestSession(deps, cookie);
      expect(access).toBeUndefined();
      expect(await resolveGuestContext(input({ access }))).toEqual({ kind: "unauthenticated" });
    }
  });
});
