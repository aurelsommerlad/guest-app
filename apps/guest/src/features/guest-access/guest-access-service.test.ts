import {
  computeAccessWindow,
  createLogger,
  generateSecret,
  hashSecret,
  type PmsReservation,
} from "@up/core";
import {
  createGuestAccess,
  type Database,
  findGuestAccessForReservation,
  revokeGuestAccessForReservation,
  seedTenant,
  uniquePlacesSeed,
} from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { MockPmsProvider } from "@up/integrations";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  enterWithLinkToken,
  type GuestAccessDeps,
  loginWithBookingReference,
  resolveGuestSession,
  SESSION_MAX_AGE_MS,
} from "./guest-access-service";
import { LOGIN_RATE_LIMIT } from "./rate-limit";

const NOW = new Date("2026-08-29T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const uniquePlaces = { tenantId: "unique-places" };

const reservation: PmsReservation = {
  provider: "apaleo",
  externalId: "ABCDEFGH-1",
  status: "in-house",
  arrivalAt: "2026-08-27T16:00:00+02:00",
  departureAt: "2026-08-31T10:00:00+02:00",
  externalPropertyId: "ALTUS",
  externalUnitId: "ALTUS-SWA",
  primaryGuest: { firstName: "Laura" },
};
const LAST_NAME = "Müller";

let test: TestDatabase;
let db: Database;
let clock: Date;
let lines: string[];
let deps: GuestAccessDeps;

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  await seedTenant(db, uniquePlacesSeed);
  clock = NOW;
  lines = [];
  deps = {
    db,
    now: () => clock,
    logger: createLogger({ level: "debug", sink: (_level, line) => lines.push(line) }),
  };
});

afterEach(async () => {
  await test.close();
});

async function linkAccess(overrides: Partial<Parameters<typeof createGuestAccess>[2]> = {}) {
  const token = generateSecret();
  const access = await createGuestAccess(db, uniquePlaces, {
    propertyId: "hov",
    unitId: "ros",
    reservationProvider: "apaleo",
    externalReservationId: reservation.externalId,
    tokenHash: hashSecret(token),
    ...computeAccessWindow(reservation),
    ...overrides,
  });
  return { token, access };
}

function pms(reservations: PmsReservation[] = [reservation], lastName = LAST_NAME) {
  return {
    provider: "apaleo" as const,
    pms: new MockPmsProvider(reservations, {
      guestLastNames: Object.fromEntries(reservations.map((item) => [item.externalId, lastName])),
    }),
  };
}

function login(
  bookingReference: string,
  lastName: string,
  options: { clientAddress?: string; reservations?: PmsReservation[] } = {},
) {
  return loginWithBookingReference(
    { ...deps, pms: pms(options.reservations) },
    {
      tenantSlug: "unique-places",
      bookingReference,
      lastName,
      clientAddress: options.clientAddress ?? "203.0.113.7",
    },
  );
}

describe("personal link", () => {
  it("starts a session for a valid token and resolves the guest access from it", async () => {
    const { token, access } = await linkAccess();
    const grant = await enterWithLinkToken(deps, token);
    expect(grant?.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(grant?.secret).not.toBe(token);
    expect(grant?.expiresAt.getTime()).toBe(access.validUntil.getTime());

    expect(await resolveGuestSession(deps, grant?.secret)).toEqual({
      guestAccessId: access.id,
      tenantId: "unique-places",
      propertyId: "hov",
      unitId: "ros",
      reservationProvider: "apaleo",
      externalReservationId: "ABCDEFGH-1",
    });
  });

  it("caps sessions at the maximum age", async () => {
    const { token } = await linkAccess({ validUntil: new Date(NOW.getTime() + 90 * DAY) });
    const grant = await enterWithLinkToken(deps, token);
    expect(grant?.expiresAt.getTime()).toBe(NOW.getTime() + SESSION_MAX_AGE_MS);
  });

  it("rejects unknown, malformed, not yet valid, expired and revoked tokens", async () => {
    expect(await enterWithLinkToken(deps, generateSecret())).toBeUndefined();
    expect(await enterWithLinkToken(deps, "abc")).toBeUndefined();
    expect(await enterWithLinkToken(deps, "../../etc/passwd")).toBeUndefined();

    const { token } = await linkAccess();
    clock = new Date("2026-07-01T00:00:00Z");
    expect(await enterWithLinkToken(deps, token)).toBeUndefined();
    clock = new Date("2026-09-03T08:00:00Z"); // departure + 3 days
    expect(await enterWithLinkToken(deps, token)).toBeUndefined();

    clock = NOW;
    await revokeGuestAccessForReservation(
      db,
      uniquePlaces,
      { provider: "apaleo", externalReservationId: reservation.externalId },
      NOW,
    );
    expect(await enterWithLinkToken(deps, token)).toBeUndefined();
  });

  it("ends existing sessions when the access is revoked", async () => {
    const { token } = await linkAccess();
    const grant = await enterWithLinkToken(deps, token);
    expect(await resolveGuestSession(deps, grant?.secret)).toBeDefined();
    await revokeGuestAccessForReservation(
      db,
      uniquePlaces,
      { provider: "apaleo", externalReservationId: reservation.externalId },
      NOW,
    );
    expect(await resolveGuestSession(deps, grant?.secret)).toBeUndefined();
  });

  it("ends sessions when the access window closes or the session expires", async () => {
    const { token } = await linkAccess();
    const grant = await enterWithLinkToken(deps, token);
    clock = new Date("2026-09-03T08:00:00Z");
    expect(await resolveGuestSession(deps, grant?.secret)).toBeUndefined();
  });

  it("issues a new session on every entry and revokes the previous one (no fixation)", async () => {
    const { token } = await linkAccess();
    const first = await enterWithLinkToken(deps, token);
    const second = await enterWithLinkToken(deps, token, first?.secret);
    expect(second?.secret).not.toBe(first?.secret);
    expect(await resolveGuestSession(deps, first?.secret)).toBeUndefined();
    expect(await resolveGuestSession(deps, second?.secret)).toBeDefined();
  });

  it("does not resolve unknown or malformed sessions", async () => {
    expect(await resolveGuestSession(deps, undefined)).toBeUndefined();
    expect(await resolveGuestSession(deps, "")).toBeUndefined();
    expect(await resolveGuestSession(deps, "not-a-session")).toBeUndefined();
    expect(await resolveGuestSession(deps, generateSecret())).toBeUndefined();
  });

  it("never stores or logs the plaintext token or session secret", async () => {
    const { token } = await linkAccess();
    const grant = await enterWithLinkToken(deps, token);
    await enterWithLinkToken(deps, generateSecret());
    const dump = JSON.stringify([
      (await test.client.query("SELECT * FROM guest_access")).rows,
      (await test.client.query("SELECT * FROM guest_sessions")).rows,
    ]);
    expect(dump).not.toContain(token);
    expect(dump).not.toContain(grant?.secret);
    const log = lines.join("\n");
    expect(log).not.toContain(token);
    expect(log).not.toContain(grant?.secret);
    expect(log).toContain('"reason":"unknown"');
  });
});

describe("booking number + last name", () => {
  it("creates a guest access and the same kind of session as the link", async () => {
    const outcome = await login("ABCDEFGH-1", LAST_NAME);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const current = await resolveGuestSession(deps, outcome.session.secret);
    expect(current).toMatchObject({
      tenantId: "unique-places",
      propertyId: "hov",
      unitId: "ros",
      reservationProvider: "apaleo",
      externalReservationId: "ABCDEFGH-1",
    });
    const [access] = await findGuestAccessForReservation(db, uniquePlaces, {
      provider: "apaleo",
      externalReservationId: "ABCDEFGH-1",
    });
    expect(access).toMatchObject(computeAccessWindow(reservation));
  });

  it("reuses an existing valid guest access instead of creating another", async () => {
    const { access } = await linkAccess();
    const outcome = await login("ABCDEFGH-1", LAST_NAME);
    expect(
      outcome.ok && (await resolveGuestSession(deps, outcome.session.secret))?.guestAccessId,
    ).toBe(access.id);
    expect(
      await findGuestAccessForReservation(db, uniquePlaces, {
        provider: "apaleo",
        externalReservationId: "ABCDEFGH-1",
      }),
    ).toHaveLength(1);
  });

  it("normalises case, whitespace and Unicode – but does not match fuzzily", async () => {
    expect((await login("  abcdefgh-1 ", "  MÜLLER ")).ok).toBe(true);
    expect((await login("ABCDEFGH-1", "Müller")).ok).toBe(true);
    expect((await login("ABCDEFGH-1", "Mueller")).ok).toBe(false);
    expect((await login("ABCDEFGH-1", "Muller")).ok).toBe(false);
  });

  it("answers every failure identically", async () => {
    const canceled = { ...reservation, externalId: "CANCELED-1", status: "canceled" as const };
    const past = {
      ...reservation,
      externalId: "PAST-1",
      arrivalAt: "2026-06-01T16:00:00+02:00",
      departureAt: "2026-06-05T10:00:00+02:00",
    };
    const reservations = [reservation, canceled, past];
    const outcomes = [
      await login("ABCDEFGH-1", "Schmidt", { reservations }), // wrong last name
      await login("UNKNOWN-1", LAST_NAME, { reservations }), // unknown booking number
      await login("CANCELED-1", LAST_NAME, { reservations }), // canceled
      await login("PAST-1", LAST_NAME, { reservations }), // stay is over
      await login("ABC/../1", LAST_NAME, { reservations }), // malformed
      await login("ABCDEFGH-1", "", { reservations }), // empty last name
    ];
    for (const outcome of outcomes) expect(outcome).toEqual({ ok: false, reason: "not-found" });
  });

  it("does not reopen a revoked reservation", async () => {
    await linkAccess();
    await revokeGuestAccessForReservation(
      db,
      uniquePlaces,
      { provider: "apaleo", externalReservationId: "ABCDEFGH-1" },
      NOW,
    );
    expect(await login("ABCDEFGH-1", LAST_NAME)).toEqual({ ok: false, reason: "not-found" });
  });

  it("rejects reservations of properties outside the tenant", async () => {
    const foreign = { ...reservation, externalId: "FOREIGN-1", externalPropertyId: "OTHER" };
    expect(await login("FOREIGN-1", LAST_NAME, { reservations: [foreign] })).toEqual({
      ok: false,
      reason: "not-found",
    });
    const wrongTenant = await loginWithBookingReference(
      { ...deps, pms: pms() },
      {
        tenantSlug: "unknown",
        bookingReference: "ABCDEFGH-1",
        lastName: LAST_NAME,
        clientAddress: "x",
      },
    );
    expect(wrongTenant).toEqual({ ok: false, reason: "not-found" });
  });

  it("rejects ambiguous matches", async () => {
    // Prepared for OTA numbers: two reservations behind one reference never log in.
    const ambiguous = {
      provider: "apaleo" as const,
      pms: {
        name: "ambiguous",
        getReservation: () => Promise.resolve(reservation),
        findReservationsByBookingReference: () =>
          Promise.resolve([
            { reservation, primaryGuestLastName: LAST_NAME },
            {
              reservation: { ...reservation, externalId: "ABCDEFGH-2" },
              primaryGuestLastName: LAST_NAME,
            },
          ]),
      },
    };
    const outcome = await loginWithBookingReference(
      { ...deps, pms: ambiguous },
      {
        tenantSlug: "unique-places",
        bookingReference: "OTA-123",
        lastName: LAST_NAME,
        clientAddress: "x",
      },
    );
    expect(outcome).toEqual({ ok: false, reason: "not-found" });
  });

  it("fails closed without a PMS or on PMS errors", async () => {
    const withoutPms = await loginWithBookingReference(
      { ...deps, pms: undefined },
      {
        tenantSlug: "unique-places",
        bookingReference: "ABCDEFGH-1",
        lastName: LAST_NAME,
        clientAddress: "x",
      },
    );
    expect(withoutPms).toEqual({ ok: false, reason: "not-found" });
    const failing = {
      provider: "apaleo" as const,
      pms: {
        name: "down",
        getReservation: () => Promise.reject(new Error("down")),
        findReservationsByBookingReference: () => Promise.reject(new Error("down")),
      },
    };
    const outcome = await loginWithBookingReference(
      { ...deps, pms: failing },
      {
        tenantSlug: "unique-places",
        bookingReference: "ABCDEFGH-1",
        lastName: LAST_NAME,
        clientAddress: "x",
      },
    );
    expect(outcome).toEqual({ ok: false, reason: "not-found" });
  });

  it("limits attempts per client address", async () => {
    for (let attempt = 0; attempt < LOGIN_RATE_LIMIT.maxPerClient; attempt++) {
      expect(await login(`WRONG-${attempt}`, LAST_NAME)).toEqual({
        ok: false,
        reason: "not-found",
      });
    }
    // Now even the correct combination is blocked for this address …
    expect(await login("ABCDEFGH-1", LAST_NAME)).toMatchObject({
      ok: false,
      reason: "rate-limited",
    });
    // … other addresses are not affected, and after the window the address may try again.
    expect((await login("ABCDEFGH-1", LAST_NAME, { clientAddress: "198.51.100.1" })).ok).toBe(true);
    clock = new Date(NOW.getTime() + LOGIN_RATE_LIMIT.windowMs);
    expect((await login("ABCDEFGH-1", LAST_NAME)).ok).toBe(true);
  });

  it("limits attempts per booking number across addresses", async () => {
    for (let attempt = 0; attempt < LOGIN_RATE_LIMIT.maxPerBookingReference; attempt++) {
      await login("ABCDEFGH-1", `Wrong${attempt}`, { clientAddress: `192.0.2.${attempt}` });
    }
    expect(await login("ABCDEFGH-1", LAST_NAME, { clientAddress: "192.0.2.99" })).toMatchObject({
      ok: false,
      reason: "rate-limited",
    });
  });

  it("never logs or stores booking numbers, last names or secrets", async () => {
    const success = await login("ABCDEFGH-1", LAST_NAME);
    await login("ZZZZZZZZ-9", "Geheimname");
    await login("ABCDEFGH-1", "Geheimname");
    const log = lines.join("\n");
    for (const value of ["ABCDEFGH", "ZZZZZZZZ", "Müller", "MÜLLER", "Geheimname", "203.0.113.7"]) {
      expect(log).not.toContain(value);
    }
    if (success.ok) expect(log).not.toContain(success.session.secret);
    const buckets = JSON.stringify(
      (await test.client.query("SELECT * FROM rate_limit_buckets")).rows,
    );
    expect(buckets).not.toMatch(/ABCDEFGH|ZZZZZZZZ|203\.0\.113\.7/);
  });

  it("supports the Apaleo reservation id only – no guessing for other numbers", async () => {
    // The mock knows only reservation ids; an OTA-style number is simply not found.
    expect(await login("4711223344", LAST_NAME)).toEqual({ ok: false, reason: "not-found" });
  });
});
