import { createLogger } from "@up/core";
import {
  createServiceLockStore,
  createServiceRecordStore,
  createServiceWriteStore,
  type Database,
  getPropertyServiceSettings,
  listAdminAuditEvents,
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
import { ApaleoDouble } from "@up/shadow/apaleo-double";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { type AdminContext } from "../auth/admin-auth-service";
import {
  decideRequest,
  type ExtensionSettingsForm,
  loadAudit,
  loadBookings,
  loadExtensionSettings,
  loadImports,
  loadRequest,
  loadRequests,
  type OperationsDeps,
  saveExtensionSettings,
} from "./operations-service";

let test: TestDatabase;
let db: Database;
let ownerId: string;
let offerId: string;
const lookup = vi.fn(() => Promise.resolve({ property: { id: "TEST" }, status: "Confirmed" }));
// In-memory Apaleo (TEST property, reservation JTKQSYFX-1, 10.–12.11.2026); nothing leaves the process.
const apaleo = new ApaleoDouble({ arrival: "2026-11-10", departure: "2026-11-12" });
const reader = new ApaleoServiceReader(
  new ApaleoClient({
    clientId: "test",
    clientSecret: "test",
    logger: createLogger({ sink: () => undefined }),
    fetch: apaleo.fetch,
    retryDelayMs: 0,
  }),
);

const deps = (mode: ServiceWriteMode = "disabled"): OperationsDeps => ({
  db,
  logger: createLogger({ sink: () => undefined }),
  now: () => new Date("2026-11-08T10:00:00Z"),
  gateway: () =>
    new ServiceWriteGateway({
      mode,
      allowedApaleoPropertyIds: ["TEST"],
      store: createServiceWriteStore(db),
      lookupReservation: lookup,
    }),
  engine: (gateway) =>
    new ServiceBookingEngine({
      reader,
      gateway,
      records: createServiceRecordStore(db),
      locks: createServiceLockStore(db),
      now: () => new Date("2026-11-08T10:00:00Z"),
    }),
  apaleoPropertyIdOf: (_tenant, propertyId) =>
    Promise.resolve(propertyId === "test-run" ? "TEST" : undefined),
});

const admin = (role: AdminContext["role"], propertyIds: string[] = []): AdminContext => ({
  adminUserId: ownerId,
  tenantId: "unique-places",
  email: "a@example.test",
  role,
  propertyScope: propertyIds.length ? "selected" : "all",
  propertyIds,
});

const settingsForm = (overrides: Partial<ExtensionSettingsForm> = {}): ExtensionSettingsForm => ({
  extensionNightEnabled: true,
  discountPreArrivalOneNightGap: "12",
  discountPreArrivalStandard: "",
  discountInHouseOneNightGap: "20",
  discountInHouseStandard: "15",
  minSellableStayNights: "2",
  ...overrides,
});

async function request(source: "stay" | "extras", property = "test-run") {
  const row = await test.client.query<{ id: string }>(
    `INSERT INTO offer_requests (tenant_id, offer_id, property_id, reservation_provider, external_reservation_id, source, legacy_id,
       quantity, apaleo_service_id, requested_dates)
     VALUES ('unique-places', $1, $2, 'apaleo', 'JTKQSYFX-1', $3, $4, 1, 'TEST-PKW', '{2026-11-10,2026-11-11}') RETURNING id`,
    [
      offerId,
      property,
      source,
      source === "extras" ? `r-${Math.random().toString(36).slice(2)}` : null,
    ],
  );
  return row.rows[0]?.id ?? "";
}

beforeAll(async () => {
  test = await createTestDatabase();
  db = test.db;
  await seedTenant(db, uniquePlacesSeed);
  await test.client.query(
    `INSERT INTO properties (id, tenant_id, slug, display_name, spoken_name, location_name, timezone)
     VALUES ('test-run', 'unique-places', 'test-run', 'Test run', 'Test run', 'Testumgebung', 'Europe/Berlin')`,
  );
  ownerId =
    (
      await test.client.query<{ id: string }>(
        `INSERT INTO admin_users (tenant_id, email, password_hash, role) VALUES ('unique-places', 'o@example.test', 'scrypt$x', 'owner') RETURNING id`,
      )
    ).rows[0]?.id ?? "";
  offerId =
    (
      await test.client.query<{ id: string }>(
        `INSERT INTO offers (tenant_id, kind, category, slug, title, teaser, fulfillment, cancellation, availability)
         VALUES ('unique-places', 'house-service', 'mobility', '{"de":"parken"}', '{"de":"Parkplatz"}', '{"de":"Parken"}', 'request',
           '{"type":"non-refundable"}', '{}') RETURNING id`,
      )
    ).rows[0]?.id ?? "";
  // Property configuration of the request service (M2 model): parking per night, on request.
  await test.client.query(
    `INSERT INTO offer_properties (tenant_id, offer_id, property_id, extras_service_id, active, action_type, booking_rule, fulfillment)
     VALUES ('unique-places', $1, 'test-run', 'TEST-PKW', true, 'service', 'per_night', 'request')`,
    [offerId],
  );
});

afterAll(async () => {
  await test.close();
});

describe("extension nights", () => {
  it("saves per property; empty discount = 0 %; validates ranges", async () => {
    expect(await saveExtensionSettings(deps(), admin("admin"), "test-run", settingsForm())).toEqual(
      { ok: true },
    );
    expect(
      await getPropertyServiceSettings(db, { tenantId: "unique-places" }, "test-run"),
    ).toMatchObject({
      extensionNightEnabled: true,
      extensionDiscountPreArrivalOneNightGap: 12,
      extensionDiscountPreArrivalStandard: 0,
      extensionDiscountInHouseStandard: 15,
    });
    expect(
      (
        await saveExtensionSettings(
          deps(),
          admin("admin"),
          "test-run",
          settingsForm({ discountInHouseStandard: "95" }),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await saveExtensionSettings(
          deps(),
          admin("admin"),
          "test-run",
          settingsForm({ minSellableStayNights: "0" }),
        )
      ).ok,
    ).toBe(false);
  });

  it("managers and viewers read, only owners/admins edit; property limits apply", async () => {
    expect(
      (await saveExtensionSettings(deps(), admin("manager"), "test-run", settingsForm())).ok,
    ).toBe(false);
    expect(
      (await saveExtensionSettings(deps(), admin("viewer"), "test-run", settingsForm())).ok,
    ).toBe(false);
    expect(
      (await saveExtensionSettings(deps(), admin("admin", ["hov"]), "test-run", settingsForm())).ok,
    ).toBe(false);
    const viewer = await loadExtensionSettings(deps(), admin("viewer", ["test-run"]), null);
    expect(viewer.ok && viewer.rows.map((r) => [r.property.id, r.canEdit])).toEqual([
      ["test-run", false],
    ]);
    expect((await loadExtensionSettings(deps(), admin("viewer", ["test-run"]), "hov")).ok).toBe(
      false,
    );
  });
});

describe("request queue – prepared approval, no Apaleo writes", () => {
  it("keeps the request open when Apaleo writes are disabled and audits the attempt", async () => {
    const id = await request("stay");
    const result = await decideRequest(
      deps("disabled"),
      admin("manager", ["test-run"]),
      id,
      "confirm",
    );
    expect(result).toEqual({
      ok: false,
      error:
        "Buchungen in Apaleo sind aus STAY noch nicht freigegeben. Die Anfrage bleibt offen; der Versuch ist protokolliert.",
    });
    expect(
      (await loadRequest(deps(), admin("owner"), id)).ok &&
        (await loadRequest(deps(), admin("owner"), id)),
    ).toMatchObject({
      request: { status: "pending" },
    });
    expect(lookup).not.toHaveBeenCalled();
    const actions = (await listAdminAuditEvents(db, { tenantId: "unique-places" })).map(
      (e) => e.action,
    );
    expect(actions).toContain("request.confirm_blocked");
  });

  it("confirms in simulated mode (staging) without sending anything to Apaleo", async () => {
    const id = await request("stay");
    expect(await decideRequest(deps("simulated"), admin("owner"), id, "confirm")).toEqual({
      ok: true,
      message: "Bestätigt (simuliert – es wurde nichts an Apaleo gesendet).",
    });
    const loaded = await loadRequest(deps(), admin("owner"), id);
    expect(loaded.ok && loaded.request).toMatchObject({
      status: "confirmed",
      bookedServiceDates: ["2026-11-10", "2026-11-11"],
    });
    expect(await decideRequest(deps("simulated"), admin("owner"), id, "decline")).toEqual({
      ok: false,
      error: "Diese Anfrage ist bereits entschieden.",
    });
  });

  it("declines without Apaleo; Extras requests stay with Extras; viewers and other properties cannot decide", async () => {
    const id = await request("stay");
    expect(await decideRequest(deps(), admin("viewer"), id, "decline")).toMatchObject({
      ok: false,
    });
    expect(await decideRequest(deps(), admin("manager", ["hov"]), id, "decline")).toEqual({
      ok: false,
      error: "Diese Anfrage gibt es nicht.",
    });
    expect(await decideRequest(deps(), admin("manager", ["test-run"]), id, "decline")).toEqual({
      ok: true,
      message: "Anfrage abgelehnt.",
    });
    const extras = await request("extras");
    expect(await decideRequest(deps("simulated"), admin("owner"), extras, "confirm")).toMatchObject(
      { ok: false },
    );
    const loaded = await loadRequest(deps(), admin("owner"), extras);
    expect(loaded.ok && loaded.canDecide).toBe(false);
  });

  it("lists requests per property and status", async () => {
    await request("stay", "hov");
    const all = await loadRequests(deps(), admin("owner"), null);
    const limited = await loadRequests(deps(), admin("viewer", ["hov"]), null);
    const pending = await loadRequests(deps(), admin("owner"), "test-run", "pending");
    expect(all.ok && all.requests.length).toBe(5);
    expect(limited.ok && limited.requests.map((r) => r.propertyId)).toEqual(["hov"]);
    expect(
      pending.ok &&
        pending.requests.every((r) => r.status === "pending" && r.propertyId === "test-run"),
    ).toBe(true);
    expect((await loadRequests(deps(), admin("viewer", ["hov"]), "test-run")).ok).toBe(false);
  });
});

describe("read models and permissions", () => {
  it("orders are readable by every role, filtered by property", async () => {
    await test.client.query(
      `INSERT INTO service_bookings (tenant_id, property_id, reservation_provider, external_reservation_id, status, source)
       VALUES ('unique-places', 'test-run', 'apaleo', 'JTKQSYFX-1', 'completed', 'extras'), ('unique-places', 'hov', 'apaleo', 'X-1', 'completed', 'stay')`,
    );
    const viewer = await loadBookings(deps(), admin("viewer", ["test-run"]), null);
    expect(viewer.ok && viewer.bookings.map((b) => b.propertyId)).toEqual(["test-run"]);
  });

  it("audit is filtered for limited admins; imports need migration.run", async () => {
    expect((await loadAudit(deps(), admin("viewer"))).ok).toBe(true);
    expect((await loadImports(deps(), admin("manager"))).ok).toBe(false);
    expect((await loadImports(deps(), admin("admin"))).ok).toBe(true);
  });
});
