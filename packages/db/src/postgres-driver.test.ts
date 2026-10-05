/**
 * Driver smoke test: the same repositories through postgres.js (the production driver)
 * over the Postgres wire protocol, served by an in-process PGlite socket server.
 * Catches driver-specific serialisation issues the PGlite driver would hide.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { generateSecret, hashSecret } from "@up/core";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "./client";
import { MIGRATIONS_FOLDER } from "./migrations-folder";
import {
  createGuestAccess,
  createGuestSession,
  findGuestSessionByTokenHash,
  revokeGuestAccessForReservation,
} from "./repositories/guest-access-repository";
import { hitRateLimit } from "./repositories/rate-limit-repository";
import { getUnitsForProperty, resolveExternalMapping } from "./repositories/tenancy-repository";
import { seedTenant } from "./seed/seed-tenant";
import { uniquePlacesSeed } from "./seed/unique-places";

const PORT = 54_000 + Math.floor(Math.random() * 1000);
let pglite: PGlite;
let server: PGLiteSocketServer;
let connection: ReturnType<typeof createDatabase>;

beforeAll(async () => {
  pglite = new PGlite();
  server = new PGLiteSocketServer({ db: pglite, port: PORT, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  connection = createDatabase(`postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`, {
    maxConnections: 1,
  });
  await migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
});

afterAll(async () => {
  await connection.close();
  await server.stop();
  await pglite.close();
});

describe("repositories via postgres.js", () => {
  const context = { tenantId: "unique-places" };
  const now = new Date("2026-08-29T10:00:00Z");

  it("seeds idempotently and resolves master data", async () => {
    const { db } = connection;
    expect((await seedTenant(db, uniquePlacesSeed)).written.units).toBe(8);
    expect((await seedTenant(db, uniquePlacesSeed)).written.units).toBe(0);
    expect((await getUnitsForProperty(db, context, "hov")).length).toBe(8);
    expect(
      await resolveExternalMapping(db, context, {
        provider: "apaleo",
        entityType: "unit",
        externalId: "ALTUS-SWA",
      }),
    ).toBe("ros");
  });

  it("creates, resolves and revokes guest access and sessions", async () => {
    const { db } = connection;
    const access = await createGuestAccess(db, context, {
      propertyId: "hov",
      unitId: "ros",
      reservationProvider: "apaleo",
      externalReservationId: "DRIVER-1",
      tokenHash: hashSecret(generateSecret()),
      validFrom: new Date("2026-08-01T00:00:00Z"),
      validUntil: new Date("2026-09-03T00:00:00Z"),
    });
    const tokenHash = hashSecret(generateSecret());
    await createGuestSession(db, context, {
      guestAccessId: access.id,
      tokenHash,
      expiresAt: new Date("2026-09-01T00:00:00Z"),
    });
    const record = await findGuestSessionByTokenHash(db, tokenHash, now);
    expect(record?.access.id).toBe(access.id);
    expect(record?.access.validUntil).toBeInstanceOf(Date);
    expect(
      await revokeGuestAccessForReservation(
        db,
        context,
        { provider: "apaleo", externalReservationId: "DRIVER-1" },
        now,
      ),
    ).toBe(1);
  });

  it("counts rate limit windows", async () => {
    const { db } = connection;
    expect((await hitRateLimit(db, "driver:a", 60_000, now)).hits).toBe(1);
    expect((await hitRateLimit(db, "driver:a", 60_000, new Date(now.getTime() + 1000))).hits).toBe(
      2,
    );
    const fresh = await hitRateLimit(db, "driver:a", 60_000, new Date(now.getTime() + 60_000));
    expect(fresh.hits).toBe(1);
    expect(fresh.windowStartedAt.getTime()).toBe(now.getTime() + 60_000);
  });
});
