/**
 * Shadow test environment: a PGlite database with the seed tenant, the "test-run" property
 * mapped to the Apaleo TEST property, the TEST services configured as own services (M2 model),
 * an in-memory Apaleo double and the booking engine with the gateway in mode "simulated".
 */
import { createLogger } from "@up/core";
import {
  createServiceLockStore,
  createServiceRecordStore,
  createServiceWriteStore,
  type Database,
  seedTenant,
  uniquePlacesSeed,
} from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import {
  ApaleoClient,
  ApaleoServiceReader,
  ServiceBookingEngine,
  ServiceWriteGateway,
  type ServiceWriteMode,
} from "@up/integrations";

import { ApaleoDouble, type DoubleOptions } from "./apaleo-double";

export const TENANT = "unique-places";
export const PROPERTY = "test-run";
export const CONTEXT = { tenantId: TENANT, propertyId: PROPERTY, apaleoPropertyId: "TEST" };

/** Own-service configuration of the TEST property as in Extras (catalog:TEST). */
export const TEST_CATALOG = [
  { serviceId: "TEST-ECI", title: "Früher Check-in", titleEn: "Early check-in", rule: "arrival_day", sort: 1 },
  { serviceId: "TEST-LCO", title: "Später Check-out", titleEn: "Late check-out", rule: "departure_day", sort: 2 },
  { serviceId: "TEST-HUND", title: "Hund", titleEn: "Dog", rule: "per_night", sort: 3, maxOne: true },
  { serviceId: "TEST-PKW", title: "Parkplatz", titleEn: "Parking", rule: "per_night", sort: 4, vehicle: true },
  { serviceId: "TEST-BABY", title: "Babybett", titleEn: "Baby cot", rule: "per_stay", sort: 5, request: true },
  { serviceId: "TEST-EXTRPERSON", title: "Zusatzperson", titleEn: "Additional guest", rule: "per_stay", sort: 6, occupancy: 3000 },
] as const;

export type ShadowEnv = {
  test: TestDatabase;
  db: Database;
  apaleo: ApaleoDouble;
  ownerId: string;
  offerIds: Record<string, string>;
  engine: (options?: { mode?: ServiceWriteMode; now?: Date; apply?: boolean }) => ServiceBookingEngine;
  reset: (options?: DoubleOptions) => void;
};

export async function createShadowEnv(options: DoubleOptions = {}): Promise<ShadowEnv> {
  const test = await createTestDatabase();
  const db = test.db;
  await seedTenant(db, uniquePlacesSeed);
  await test.client.query(
    `INSERT INTO properties (id, tenant_id, slug, display_name, spoken_name, location_name, timezone)
     VALUES ($1, $2, $1, 'Test run', 'Test run', 'Testumgebung', 'Europe/Berlin')`,
    [PROPERTY, TENANT],
  );
  await test.client.query(
    `INSERT INTO external_mappings (tenant_id, provider, entity_type, internal_entity_id, external_id)
     VALUES ($1, 'apaleo', 'property', $2, 'TEST')`,
    [TENANT, PROPERTY],
  );
  const ownerId =
    (
      await test.client.query<{ id: string }>(
        `INSERT INTO admin_users (tenant_id, email, password_hash, role)
         VALUES ($1, 'owner@example.test', 'scrypt$x', 'owner') RETURNING id`,
        [TENANT],
      )
    ).rows[0]?.id ?? "";
  const offerIds: Record<string, string> = {};
  for (const item of TEST_CATALOG) {
    const isRequest = "request" in item;
    const offer = await test.client.query<{ id: string }>(
      `INSERT INTO offers (tenant_id, kind, category, status, slug, title, teaser, fulfillment, cancellation, availability, sort_order)
       VALUES ($1, 'house-service', 'comfort', 'published', $2, $3, $4, $5, '{"type":"on-request"}', '{}', $6) RETURNING id`,
      [
        TENANT,
        JSON.stringify({ de: item.serviceId.toLowerCase() }),
        JSON.stringify({ de: item.title, en: item.titleEn }),
        JSON.stringify({ de: item.title, en: item.titleEn }),
        isRequest ? "request" : "instant",
        item.sort,
      ],
    );
    const offerId = offer.rows[0]?.id ?? "";
    offerIds[item.serviceId] = offerId;
    const occupancy = "occupancy" in item;
    await test.client.query(
      `INSERT INTO offer_properties (tenant_id, offer_id, property_id, extras_service_id, sort_order, active, action_type,
         booking_rule, fulfillment, extra_person_price_cents, currency, requires_remaining_capacity,
         requires_vehicle_registration, max_one_per_reservation)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        TENANT,
        offerId,
        PROPERTY,
        item.serviceId,
        item.sort,
        occupancy ? "increase_occupancy" : "service",
        item.rule,
        isRequest ? "request" : "instant",
        occupancy ? item.occupancy : null,
        occupancy ? "EUR" : null,
        occupancy,
        "vehicle" in item,
        "maxOne" in item,
      ],
    );
  }
  await test.client.query(
    `INSERT INTO property_service_settings (tenant_id, property_id, extension_night_enabled)
     VALUES ($1, $2, true)`,
    [TENANT, PROPERTY],
  );

  const env: ShadowEnv = {
    test,
    db,
    apaleo: new ApaleoDouble(options),
    ownerId,
    offerIds,
    reset: (next = options) => {
      env.apaleo = new ApaleoDouble(next);
    },
    engine: ({ mode = "simulated", now = new Date("2027-01-05T10:00:00Z"), apply = true } = {}) => {
      const apaleo = env.apaleo;
      const client = new ApaleoClient({
        clientId: "shadow",
        clientSecret: "shadow",
        logger: createLogger({ sink: () => undefined }),
        fetch: apaleo.fetch,
        retryDelayMs: 0,
      });
      const reader = new ApaleoServiceReader(client);
      const gateway = new ServiceWriteGateway({
        mode,
        allowedApaleoPropertyIds: ["TEST"],
        store: createServiceWriteStore(db),
        lookupReservation: (id) => reader.getReservation(id),
        ...(apply ? { onSimulated: apaleo.applySimulated } : {}),
        now: () => now,
      });
      return new ServiceBookingEngine({
        reader,
        gateway,
        records: createServiceRecordStore(db),
        locks: createServiceLockStore(db),
        now: () => now,
        verifySimulatedWrites: apply ? "check" : "skip",
      });
    },
  };
  return env;
}

/** Reads a reservation from the double the way the engine does. */
export function readReservation(env: ShadowEnv, reservationId: string) {
  const client = new ApaleoClient({
    clientId: "shadow",
    clientSecret: "shadow",
    logger: createLogger({ sink: () => undefined }),
    fetch: env.apaleo.fetch,
    retryDelayMs: 0,
  });
  return new ApaleoServiceReader(client).getReservation(reservationId);
}
