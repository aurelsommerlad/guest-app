import { generateSecret, hashSecret } from "@up/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database } from "../client";
import { guestAccess } from "../schema";
import { seedTenant } from "../seed/seed-tenant";
import { uniquePlacesSeed } from "../seed/unique-places";
import {
  createTestDatabase,
  expectConstraintViolation,
  type TestDatabase,
} from "../testing/test-database";
import {
  createGuestAccess,
  createGuestSession,
  findGuestAccessByTokenHash,
  findGuestAccessForReservation,
  findGuestSessionByTokenHash,
  markGuestAccessUsed,
  revokeGuestAccessForReservation,
  revokeGuestSession,
} from "./guest-access-repository";

let db: Database;
let client: TestDatabase["client"];
let close: () => Promise<void>;

const uniquePlaces = { tenantId: "unique-places" };
const other = { tenantId: "other-tenant" };
const now = new Date("2026-08-29T10:00:00Z");
const window = {
  validFrom: new Date("2026-08-01T00:00:00Z"),
  validUntil: new Date("2026-09-03T00:00:00Z"),
};

function newAccess(overrides: Partial<Parameters<typeof createGuestAccess>[2]> = {}) {
  return {
    propertyId: "hov",
    unitId: "ros",
    reservationProvider: "apaleo" as const,
    externalReservationId: "ABCDEFGH-1",
    tokenHash: hashSecret(generateSecret()),
    ...window,
    ...overrides,
  };
}

beforeAll(async () => {
  ({ db, client, close } = await createTestDatabase());
  await seedTenant(db, uniquePlacesSeed);
  await seedTenant(db, {
    tenant: { id: "other-tenant", slug: "other-tenant", name: "Other" },
    properties: [
      {
        id: "other-hov",
        slug: "hov",
        displayName: "Other",
        spokenName: "Other",
        locationName: "Ort",
        timezone: "Europe/Berlin",
        units: [{ id: "other-ros", slug: "ros", displayName: "ROS" }],
      },
    ],
  });
});

afterAll(async () => {
  await close();
});

describe("guest_access", () => {
  it("stores only the token hash – never the plaintext token", async () => {
    const token = generateSecret();
    const access = await createGuestAccess(
      db,
      uniquePlaces,
      newAccess({ tokenHash: hashSecret(token) }),
    );
    expect(await findGuestAccessByTokenHash(db, hashSecret(token))).toEqual(access);

    const dump = await client.query("SELECT * FROM guest_access");
    expect(JSON.stringify(dump.rows)).not.toContain(token);
    // No column for personal data exists at all.
    const columns = await client.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'guest_access'",
    );
    expect(columns.rows.map((row) => row.column_name).sort()).toEqual(
      [
        "created_at",
        "external_reservation_id",
        "id",
        "last_used_at",
        "property_id",
        "reservation_provider",
        "revoked_at",
        "tenant_id",
        "token_hash",
        "unit_id",
        "updated_at",
        "valid_from",
        "valid_until",
      ].sort(),
    );
  });

  it("returns undefined for unknown or malformed token hashes", async () => {
    expect(await findGuestAccessByTokenHash(db, hashSecret("unknown"))).toBeUndefined();
    expect(await findGuestAccessByTokenHash(db, "not-a-hash")).toBeUndefined();
  });

  it("allows a missing unit", async () => {
    const access = await createGuestAccess(db, uniquePlaces, newAccess({ unitId: undefined }));
    expect(access.unitId).toBeUndefined();
  });

  it("requires the property to belong to the tenant", async () => {
    await expectConstraintViolation(
      createGuestAccess(
        db,
        uniquePlaces,
        newAccess({ propertyId: "other-hov", unitId: undefined }),
      ),
      "guest_access_property_fkey",
    );
  });

  it("requires the unit to belong to the same property and tenant", async () => {
    await expectConstraintViolation(
      createGuestAccess(db, other, newAccess({ propertyId: "other-hov", unitId: "ros" })),
      "guest_access_unit_fkey",
    );
    await expectConstraintViolation(
      createGuestAccess(db, uniquePlaces, newAccess({ propertyId: "huesle", unitId: "ros" })),
      "guest_access_unit_fkey",
    );
  });

  it("rejects invalid windows, hashes and providers", async () => {
    await expectConstraintViolation(
      createGuestAccess(db, uniquePlaces, newAccess({ validUntil: window.validFrom })),
      "guest_access_valid_range",
    );
    await expect(
      createGuestAccess(db, uniquePlaces, newAccess({ tokenHash: "plaintext" })),
    ).rejects.toThrow(TypeError);
    await expectConstraintViolation(
      db
        .insert(guestAccess)
        .values({ ...newAccess(), tenantId: "unique-places", tokenHash: "x".repeat(64) }),
      "guest_access_token_hash_format",
    );
    await expectConstraintViolation(
      db.execute(sql`INSERT INTO guest_access (tenant_id, property_id, reservation_provider, external_reservation_id, token_hash, valid_from, valid_until)
                     VALUES ('unique-places', 'hov', 'channex', 'X', ${hashSecret("p")}, now(), now() + interval '1 day')`),
      "guest_access_reservation_provider_valid",
    );
  });

  it("keeps token hashes unique", async () => {
    const tokenHash = hashSecret(generateSecret());
    await createGuestAccess(db, uniquePlaces, newAccess({ tokenHash }));
    await expectConstraintViolation(
      createGuestAccess(db, uniquePlaces, newAccess({ tokenHash })),
      "guest_access_token_hash_key",
    );
  });

  it("finds a reservation's access only within the tenant", async () => {
    const reservation = { provider: "apaleo" as const, externalReservationId: "ISOLATED-1" };
    await createGuestAccess(db, uniquePlaces, newAccess({ externalReservationId: "ISOLATED-1" }));
    await createGuestAccess(
      db,
      other,
      newAccess({
        propertyId: "other-hov",
        unitId: "other-ros",
        externalReservationId: "ISOLATED-1",
      }),
    );
    const own = await findGuestAccessForReservation(db, uniquePlaces, reservation);
    expect(own).toHaveLength(1);
    expect(own[0]?.tenantId).toBe("unique-places");
    expect(await findGuestAccessForReservation(db, { tenantId: "nobody" }, reservation)).toEqual(
      [],
    );
  });

  it("revokes all access of a reservation, tenant-scoped", async () => {
    const reservation = { provider: "apaleo" as const, externalReservationId: "REVOKE-1" };
    await createGuestAccess(db, uniquePlaces, newAccess({ externalReservationId: "REVOKE-1" }));
    await createGuestAccess(db, uniquePlaces, newAccess({ externalReservationId: "REVOKE-1" }));
    expect(await revokeGuestAccessForReservation(db, other, reservation, now)).toBe(0);
    expect(await revokeGuestAccessForReservation(db, uniquePlaces, reservation, now)).toBe(2);
    expect(await revokeGuestAccessForReservation(db, uniquePlaces, reservation, now)).toBe(0);
    const records = await findGuestAccessForReservation(db, uniquePlaces, reservation);
    expect(records.every((record) => record.revokedAt?.getTime() === now.getTime())).toBe(true);
  });

  it("records the last use", async () => {
    const access = await createGuestAccess(db, uniquePlaces, newAccess());
    await markGuestAccessUsed(db, uniquePlaces, access.id, now);
    const result = await client.query<{ last_used_at: Date }>(
      "SELECT last_used_at FROM guest_access WHERE id = $1",
      [access.id],
    );
    expect(result.rows[0]?.last_used_at.getTime()).toBe(now.getTime());
  });
});

describe("guest_sessions", () => {
  it("resolves a live session together with its access", async () => {
    const access = await createGuestAccess(db, uniquePlaces, newAccess());
    const secret = generateSecret();
    const expiresAt = new Date(now.getTime() + 60_000);
    await createGuestSession(db, uniquePlaces, {
      guestAccessId: access.id,
      tokenHash: hashSecret(secret),
      expiresAt,
    });

    const record = await findGuestSessionByTokenHash(db, hashSecret(secret), now);
    expect(record?.access).toEqual(access);
    expect(record?.session.expiresAt.getTime()).toBe(expiresAt.getTime());
    expect(await findGuestSessionByTokenHash(db, hashSecret(secret), expiresAt)).toBeUndefined();
    const dump = await client.query("SELECT * FROM guest_sessions");
    expect(JSON.stringify(dump.rows)).not.toContain(secret);
  });

  it("does not resolve revoked or unknown sessions", async () => {
    const access = await createGuestAccess(db, uniquePlaces, newAccess());
    const tokenHash = hashSecret(generateSecret());
    await createGuestSession(db, uniquePlaces, {
      guestAccessId: access.id,
      tokenHash,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await revokeGuestSession(db, tokenHash, now);
    expect(await findGuestSessionByTokenHash(db, tokenHash, now)).toBeUndefined();
    expect(await findGuestSessionByTokenHash(db, hashSecret("unknown"), now)).toBeUndefined();
    expect(await findGuestSessionByTokenHash(db, "garbage", now)).toBeUndefined();
  });

  it("cannot attach a session to another tenant's access", async () => {
    const access = await createGuestAccess(db, uniquePlaces, newAccess());
    await expectConstraintViolation(
      createGuestSession(db, other, {
        guestAccessId: access.id,
        tokenHash: hashSecret(generateSecret()),
        expiresAt: new Date(now.getTime() + 60_000),
      }),
      "guest_sessions_guest_access_fkey",
    );
  });
});
