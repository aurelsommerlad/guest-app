import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database } from "../client";
import { seedTenant } from "../seed/seed-tenant";
import { uniquePlacesSeed } from "../seed/unique-places";
import {
  createTestDatabase,
  expectConstraintViolation,
  type TestDatabase,
} from "../testing/test-database";
import { createAdminUser } from "./admin-repository";
import { listAdminAuditEvents, recordAdminAuditEvent } from "./audit-repository";
import {
  completeApaleoWrite,
  enqueueNotification,
  getPropertyServiceSettings,
  getServiceWriterState,
  reserveApaleoWrite,
  transitionGoLiveState,
  upsertPropertyServiceSettings,
} from "./service-operations-repository";

const up = { tenantId: "unique-places" };
const now = new Date("2026-11-08T10:00:00Z");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

let db: Database;
let client: TestDatabase["client"];
let close: () => Promise<void>;
let ownerId: string;

beforeAll(async () => {
  ({ db, client, close } = await createTestDatabase());
  await seedTenant(db, uniquePlacesSeed);
  ownerId = (
    await createAdminUser(db, up, {
      email: "owner@example.test",
      passwordHash: "scrypt$x",
      role: "owner",
    })
  ).id;
});

afterAll(async () => {
  await close();
});

describe("property service settings", () => {
  it("defaults to the Extras defaults with the extension switched off", async () => {
    expect(await getPropertyServiceSettings(db, up, "hov")).toMatchObject({
      extensionNightEnabled: false,
      extensionDiscountInHouseOneNightGap: 20,
      minSellableStayNights: 2,
      slackRoute: null,
    });
  });

  it("stores settings per property and rejects out-of-range discounts", async () => {
    const settings = {
      extensionNightEnabled: true,
      extensionDiscountPreArrivalOneNightGap: 12,
      extensionDiscountPreArrivalStandard: 8,
      extensionDiscountInHouseOneNightGap: 25,
      extensionDiscountInHouseStandard: 18,
      minSellableStayNights: 3,
      slackRoute: "front-office",
    };
    await upsertPropertyServiceSettings(db, up, {
      propertyId: "hov",
      settings,
      actorAdminId: ownerId,
    });
    expect(await getPropertyServiceSettings(db, up, "hov")).toEqual(settings);
    expect((await getPropertyServiceSettings(db, up, "huesle")).extensionNightEnabled).toBe(false);
    await expectConstraintViolation(
      upsertPropertyServiceSettings(db, up, {
        propertyId: "huesle",
        settings: { ...settings, extensionDiscountInHouseStandard: 95 },
        actorAdminId: ownerId,
      }),
      "property_service_settings_discounts_valid",
    );
  });
});

describe("production writer (prepared joint go-live)", () => {
  it("defaults to Extras as the only writer", async () => {
    expect(await getServiceWriterState(db, up)).toMatchObject({
      serviceWriter: "extras",
      goLiveState: "extras_active",
    });
  });

  it("rejects any writer change outside the go-live procedure", async () => {
    await client.query(
      `INSERT INTO tenant_service_settings (tenant_id) VALUES ('unique-places') ON CONFLICT DO NOTHING`,
    );
    let error: unknown;
    try {
      await client.query(
        `UPDATE tenant_service_settings SET service_writer = 'stay', go_live_state = 'stay_active' WHERE tenant_id = 'unique-places'`,
      );
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).toContain("only via the go-live procedure");
    expect((await getServiceWriterState(db, up)).serviceWriter).toBe("extras");
  });

  it("never lets writer and state disagree (database check)", async () => {
    await expectConstraintViolation(
      db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('up.writer_switch', 'on', true)`);
        await tx.execute(
          sql`UPDATE tenant_service_settings SET service_writer = 'stay' WHERE tenant_id = 'unique-places'`,
        );
      }),
      "tenant_service_settings_writer_matches_state",
    );
  });

  it("only allows the documented order, checks before activation and the fallback", async () => {
    expect(
      await transitionGoLiveState(db, up, { to: "stay_active", actorAdminId: ownerId, now }),
    ).toEqual({
      ok: false,
      reason: "invalid-transition",
    });
    expect(
      (await transitionGoLiveState(db, up, { to: "syncing", actorAdminId: ownerId, now })).ok,
    ).toBe(true);
    expect(
      (await transitionGoLiveState(db, up, { to: "extras_locked", actorAdminId: ownerId, now })).ok,
    ).toBe(true);
    expect(
      await transitionGoLiveState(db, up, {
        to: "stay_active",
        actorAdminId: ownerId,
        now,
        checks: { sync: true, smoke: false },
      }),
    ).toEqual({ ok: false, reason: "checks-failed" });
    expect(await getServiceWriterState(db, up)).toMatchObject({
      serviceWriter: "extras",
      goLiveState: "extras_locked",
    });
    // Fallback before activation: Extras takes over again.
    expect(
      (await transitionGoLiveState(db, up, { to: "extras_active", actorAdminId: ownerId, now })).ok,
    ).toBe(true);
    expect(await getServiceWriterState(db, up)).toMatchObject({
      serviceWriter: "extras",
      goLiveState: "extras_active",
    });
    const audit = await listAdminAuditEvents(db, up);
    expect(audit.filter((e) => e.action === "writer.state_changed")).toHaveLength(3);
  });
});

describe("Apaleo write log", () => {
  const base = {
    propertyId: "hov",
    externalReservationId: "ABCDEF-1",
    operation: "book-service" as const,
    requestHash: HASH_A,
    trigger: "guest" as const,
  };

  it("acquires once per idempotency key; parallel duplicates wait, retries get the result", async () => {
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        reserveApaleoWrite(db, up, { ...base, idempotencyKey: "order:1:svc", now }),
      ),
    );
    expect(results.filter((r) => r.kind === "acquired")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "in-progress")).toHaveLength(2);
    const acquired = results.find((r) => r.kind === "acquired");
    if (acquired?.kind !== "acquired") throw new Error("expected acquisition");
    await completeApaleoWrite(db, up, {
      id: acquired.id,
      status: "simulated",
      resultCode: "writes_disabled",
      now,
    });
    expect(
      await reserveApaleoWrite(db, up, { ...base, idempotencyKey: "order:1:svc", now }),
    ).toMatchObject({
      kind: "done",
      status: "simulated",
      resultCode: "writes_disabled",
    });
  });

  it("refuses a reused key with a different payload", async () => {
    await reserveApaleoWrite(db, up, { ...base, idempotencyKey: "order:2:svc", now });
    expect(
      await reserveApaleoWrite(db, up, {
        ...base,
        requestHash: HASH_B,
        idempotencyKey: "order:2:svc",
        now,
      }),
    ).toMatchObject({
      kind: "conflict",
    });
  });

  it("lets exactly one retry take over an expired lock and flags the unknown outcome", async () => {
    await reserveApaleoWrite(db, up, { ...base, idempotencyKey: "order:3:svc", now, lockMs: 1000 });
    const later = new Date(now.getTime() + 5000);
    const retries = await Promise.all(
      [1, 2].map(() =>
        reserveApaleoWrite(db, up, { ...base, idempotencyKey: "order:3:svc", now: later }),
      ),
    );
    expect(retries.filter((r) => r.kind === "acquired" && r.takeover)).toHaveLength(1);
  });

  it("rejects keys and result codes that could carry personal data", async () => {
    await expectConstraintViolation(
      reserveApaleoWrite(db, up, { ...base, idempotencyKey: "max.mustermann@example.test", now }),
      "apaleo_write_operations_values_valid",
    );
  });
});

describe("audit log and outbox", () => {
  it("is append-only", async () => {
    await recordAdminAuditEvent(db, up, {
      actorType: "system",
      action: "test.created",
      entityType: "test",
    });
    await expect(
      client.query(`UPDATE admin_audit_events SET action = 'test.changed'`),
    ).rejects.toThrow(/append-only/);
    await expect(client.query(`DELETE FROM admin_audit_events`)).rejects.toThrow(/append-only/);
    await expect(client.query(`TRUNCATE admin_audit_events`)).rejects.toThrow(/append-only/);
  });

  it("refuses personal data keys in audit details and notification payloads", async () => {
    await expect(
      recordAdminAuditEvent(db, up, {
        actorType: "system",
        action: "test.created",
        entityType: "test",
        details: { guestName: "x" },
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      enqueueNotification(db, up, {
        channel: "slack",
        template: "order.created",
        dedupKey: "x",
        payload: { email: "x" },
      }),
    ).rejects.toThrow(TypeError);
  });

  it("queues one notification per event and keeps guest channels suppressed", async () => {
    const job = {
      channel: "slack" as const,
      template: "order.created",
      dedupKey: "order:1",
      propertyId: "hov",
    };
    expect(await enqueueNotification(db, up, job)).toEqual({ created: true });
    expect(await enqueueNotification(db, up, job)).toEqual({ created: false });
    await enqueueNotification(db, up, {
      channel: "guest-email",
      template: "request.approved",
      dedupKey: "request:1:approved",
    });
    const rows = await client.query<{ channel: string; status: string }>(
      `SELECT channel, status FROM notification_outbox ORDER BY created_at`,
    );
    expect(rows.rows).toEqual([
      { channel: "slack", status: "pending" },
      { channel: "guest-email", status: "suppressed" },
    ]);
  });
});

describe("catalog configuration shape (trigger)", () => {
  it("allows Apaleo booking settings only on own services and overrides only on partner offers", async () => {
    const house = await client.query<{ id: string }>(
      `INSERT INTO offers (tenant_id, kind, category, slug, title, teaser, fulfillment, cancellation, availability)
       VALUES ('unique-places', 'house-service', 'comfort', '{"de":"x"}', '{"de":"X"}', '{"de":"X"}', 'instant',
         '{"type":"non-refundable"}', '{}') RETURNING id`,
    );
    const offerId = house.rows[0]?.id;
    await client.query(
      `INSERT INTO offer_properties (tenant_id, offer_id, property_id, extras_service_id, action_type, booking_rule)
       VALUES ('unique-places', $1, 'hov', 'HOV-LCO', 'service', 'departure_day')`,
      [offerId],
    );
    await expect(
      client.query(
        `UPDATE offer_properties SET price_override = '{"model":"fixed","amountCents":100,"currency":"EUR"}' WHERE offer_id = $1`,
        [offerId],
      ),
    ).rejects.toThrow(/only allowed for partner offers/);
    await expectConstraintViolation(
      client.query(
        `INSERT INTO offer_properties (tenant_id, offer_id, property_id, action_type, fulfillment)
         VALUES ('unique-places', $1, 'huesle', 'increase_occupancy', 'request')`,
        [offerId],
      ),
      "offer_properties_occupancy_shape",
    );
  });
});
