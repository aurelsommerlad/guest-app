import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database } from "../client";
import { paymentAuditEvents, paymentRequests, reservationPaymentStates } from "../schema";
import { seedTenant } from "../seed/seed-tenant";
import { uniquePlacesSeed } from "../seed/unique-places";
import { createTestDatabase, expectConstraintViolation } from "../testing/test-database";
import {
  findPaymentRequestByReturnRef,
  getReservationPaymentState,
  listOpenPaymentRequests,
  listPaymentAuditEvents,
  openPaymentRequest,
  recordPaymentObservation,
  updatePaymentRequestStatus,
} from "./payment-repository";

/** Drizzle wraps driver errors – match the message anywhere in the cause chain. */
async function expectRejected(query: PromiseLike<unknown>, pattern: RegExp): Promise<void> {
  let caught: unknown;
  try {
    await query;
  } catch (error) {
    caught = error;
  }
  const messages: string[] = [];
  for (let current = caught; current instanceof Error; current = current.cause) {
    messages.push(current.message);
  }
  expect(messages.join(" | ")).toMatch(pattern);
}

let db: Database;
let close: () => Promise<void>;
const up = { tenantId: "unique-places" };
const other = { tenantId: "other-tenant" };

let counter = 0;
const reservation = () => {
  counter += 1;
  return { reservationProvider: "apaleo" as const, externalReservationId: `PAY-${counter}` };
};
const key = (...parts: string[]) => createHash("sha256").update(parts.join("|")).digest("hex");
const ref = () => randomBytes(24).toString("base64url");
const t = (iso: string) => new Date(iso);

function request(res: ReturnType<typeof reservation>, folioId: string, amountMinor = 33700) {
  return {
    ...res,
    propertyId: "hov",
    externalBookingId: "BOOKING",
    paymentProvider: "apaleo" as const,
    folioId,
    amountMinor,
    currency: "EUR",
    idempotencyKey: key(res.externalReservationId, folioId, String(amountMinor), ref()),
    returnRef: ref(),
    expiresAt: t("2026-12-30T11:00:00Z"),
    actor: "guest" as const,
  };
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
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
        units: [{ id: "other-unit", slug: "u", displayName: "U" }],
      },
    ],
  });
});

afterAll(async () => {
  await close();
});

describe("reservation payment state", () => {
  it("records each check instant, state changes and the first confirmation – once", async () => {
    const res = reservation();
    const base = { ...res, propertyId: "hov", externalBookingId: "B1" };
    await recordPaymentObservation(db, up, {
      ...base,
      state: "not-due",
      observedAt: t("2026-11-05T10:00:00Z"),
    });
    // Same state again: only the check instant moves, no new audit event.
    await recordPaymentObservation(db, up, {
      ...base,
      state: "not-due",
      observedAt: t("2026-11-06T10:00:00Z"),
    });
    await recordPaymentObservation(db, up, {
      ...base,
      state: "due",
      observedAt: t("2026-12-30T09:00:00Z"),
    });
    const cleared = await recordPaymentObservation(db, up, {
      ...base,
      state: "paid",
      observedAt: t("2026-12-30T10:05:00Z"),
      confirmed: { amountMinor: 33700, currency: "EUR", providerPaymentIds: ["P-1"] },
    });
    expect(cleared.clearedAt?.toISOString()).toBe("2026-12-30T10:05:00.000Z");

    // Later extras (due again) and an outage (unknown) never clear or un-clear anything.
    await recordPaymentObservation(db, up, {
      ...base,
      state: "due",
      observedAt: t("2027-01-13T08:00:00Z"),
    });
    const later = await recordPaymentObservation(db, up, {
      ...base,
      state: "paid",
      observedAt: t("2027-01-13T09:00:00Z"),
      confirmed: { amountMinor: 3700, currency: "EUR", providerPaymentIds: ["P-2"] },
    });
    expect(later).toMatchObject({ clearedAmountMinor: 33700, lastState: "paid" });
    expect(later.clearedAt?.toISOString()).toBe("2026-12-30T10:05:00.000Z");
    expect(later.lastCheckedAt.toISOString()).toBe("2027-01-13T09:00:00.000Z");

    const events = await listPaymentAuditEvents(db, up, res);
    expect(events.map((event) => [event.kind, event.state])).toEqual([
      ["state-observed", "not-due"],
      ["state-observed", "due"],
      ["state-observed", "paid"],
      ["payment-confirmed", "paid"],
      ["state-observed", "due"],
      ["state-observed", "paid"],
    ]);
    const confirmation = events.find((event) => event.kind === "payment-confirmed");
    expect(confirmation).toMatchObject({
      amountMinor: 33700,
      currency: "EUR",
      providerPaymentIds: ["P-1"],
      actor: "system",
    });
    expect(confirmation?.observedAt.toISOString()).toBe("2026-12-30T10:05:00.000Z");
  });

  it("is tenant-isolated: another tenant neither sees nor writes this reservation", async () => {
    const res = reservation();
    await recordPaymentObservation(db, up, {
      ...res,
      propertyId: "hov",
      state: "due",
      observedAt: t("2026-12-30T09:00:00Z"),
    });
    expect(await getReservationPaymentState(db, other, res)).toBeUndefined();
    expect(await listPaymentAuditEvents(db, other, res)).toEqual([]);
    // A foreign tenant cannot attach a state to our property (composite FK).
    await expectConstraintViolation(
      recordPaymentObservation(db, other, {
        ...res,
        propertyId: "hov",
        state: "paid",
        observedAt: t("2026-12-30T10:00:00Z"),
      }),
      "reservation_payment_states_property_fkey",
    );
  });

  it("cleared_at is write-once in the database itself", async () => {
    const res = reservation();
    await recordPaymentObservation(db, up, {
      ...res,
      propertyId: "hov",
      state: "paid",
      observedAt: t("2026-12-30T10:00:00Z"),
      confirmed: { amountMinor: 1000, currency: "EUR", providerPaymentIds: ["P"] },
    });
    await expectRejected(
      db.execute(
        sql`UPDATE reservation_payment_states SET cleared_at = NULL, cleared_amount_minor = NULL, cleared_currency = NULL WHERE external_reservation_id = ${res.externalReservationId}`,
      ),
      /write-once/,
    );
    await expectRejected(
      db.execute(
        sql`DELETE FROM reservation_payment_states WHERE external_reservation_id = ${res.externalReservationId}`,
      ),
      /not deleted/,
    );
  });
});

describe("audit trail is append-only", () => {
  it("rejects UPDATE, DELETE and TRUNCATE", async () => {
    const res = reservation();
    await recordPaymentObservation(db, up, {
      ...res,
      propertyId: "hov",
      state: "due",
      observedAt: t("2026-12-30T09:00:00Z"),
    });
    await expectRejected(
      db.execute(sql`UPDATE payment_audit_events SET state = 'paid'`),
      /append-only/,
    );
    await expectRejected(db.execute(sql`DELETE FROM payment_audit_events`), /append-only/);
    await expectRejected(db.execute(sql`TRUNCATE payment_audit_events`), /append-only/);
  });
});

describe("payment requests", () => {
  it("one open request per folio: a second attempt returns the existing one", async () => {
    const res = reservation();
    const first = await openPaymentRequest(db, up, request(res, `${res.externalReservationId}-1`));
    const again = await openPaymentRequest(db, up, request(res, `${res.externalReservationId}-1`));
    expect(first.created).toBe(true);
    expect(again).toEqual({ created: false, request: first.request });
    expect(await listOpenPaymentRequests(db, up, res)).toHaveLength(1);
  });

  it("parallel attempts (two tabs, double click) still create exactly one", async () => {
    const res = reservation();
    const folio = `${res.externalReservationId}-1`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => openPaymentRequest(db, up, request(res, folio))),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.request.id)).size).toBe(1);
  });

  it("the database itself rejects a second open request for the same folio", async () => {
    const res = reservation();
    const folio = `${res.externalReservationId}-1`;
    await openPaymentRequest(db, up, request(res, folio));
    const second = request(res, folio);
    await expectConstraintViolation(
      db.insert(paymentRequests).values({ ...second, tenantId: "unique-places" }),
      "payment_requests_one_open_per_folio",
    );
  });

  it("several folios of one reservation and several reservations of one booking are separate", async () => {
    const a = reservation();
    const b = reservation();
    await openPaymentRequest(db, up, request(a, `${a.externalReservationId}-1`));
    await openPaymentRequest(db, up, request(a, `${a.externalReservationId}-2`, 5000));
    await openPaymentRequest(db, up, request(b, `${b.externalReservationId}-1`));
    expect(await listOpenPaymentRequests(db, up, a)).toHaveLength(2);
    expect(await listOpenPaymentRequests(db, up, b)).toHaveLength(1);
  });

  it("a folio cannot be claimed for another reservation", async () => {
    const a = reservation();
    const b = reservation();
    const folio = `${a.externalReservationId}-1`;
    await openPaymentRequest(db, up, request(a, folio));
    await expect(openPaymentRequest(db, up, request(b, folio))).rejects.toThrow(
      /another reservation/,
    );
  });

  it("status follows allowed transitions only, final states are immutable, all audited", async () => {
    const res = reservation();
    const { request: created } = await openPaymentRequest(
      db,
      up,
      request(res, `${res.externalReservationId}-1`),
    );
    // A live link needs the provider's payment id (DB check).
    await expectConstraintViolation(
      db.execute(sql`UPDATE payment_requests SET status = 'pending' WHERE id = ${created.id}`),
      "payment_requests_provider_payment_id_required",
    );
    const pending = await updatePaymentRequestStatus(db, up, {
      id: created.id,
      status: "pending",
      providerPaymentId: "LINK-1",
      checkedAt: t("2026-12-30T10:00:00Z"),
    });
    expect(pending?.status).toBe("pending");
    // Skipping back is not possible.
    expect(
      await updatePaymentRequestStatus(db, up, {
        id: created.id,
        status: "pending",
        checkedAt: t("2026-12-30T10:01:00Z"),
      }),
    ).toBeUndefined();
    const done = await updatePaymentRequestStatus(db, up, {
      id: created.id,
      status: "succeeded",
      checkedAt: t("2026-12-30T10:05:00Z"),
    });
    expect(done?.settledAt?.toISOString()).toBe("2026-12-30T10:05:00.000Z");
    expect(
      await updatePaymentRequestStatus(db, up, {
        id: created.id,
        status: "failed",
        checkedAt: t("2026-12-30T10:06:00Z"),
      }),
    ).toBeUndefined();
    // Another tenant cannot touch it.
    expect(
      await updatePaymentRequestStatus(db, other, {
        id: created.id,
        status: "canceled",
        checkedAt: t("2026-12-30T10:07:00Z"),
      }),
    ).toBeUndefined();
    // Settled: the folio is free for a new request (e.g. a later extra).
    expect(await listOpenPaymentRequests(db, up, res)).toEqual([]);

    const events = await listPaymentAuditEvents(db, up, res);
    expect(events.map((event) => [event.kind, event.state, event.actor])).toEqual([
      ["request-created", "preparing", "guest"],
      ["request-status-changed", "pending", "system"],
      ["request-status-changed", "succeeded", "system"],
    ]);
  });

  it("return references resolve only within the tenant and the session's reservation", async () => {
    const res = reservation();
    const input = request(res, `${res.externalReservationId}-1`);
    await openPaymentRequest(db, up, input);
    expect(await findPaymentRequestByReturnRef(db, up, res, input.returnRef)).toBeDefined();
    expect(await findPaymentRequestByReturnRef(db, other, res, input.returnRef)).toBeUndefined();
    expect(
      await findPaymentRequestByReturnRef(db, up, reservation(), input.returnRef),
    ).toBeUndefined();
    expect(await findPaymentRequestByReturnRef(db, up, res, "../../x")).toBeUndefined();
  });

  it("validates amounts, currency, keys and references before touching the database", async () => {
    const res = reservation();
    const valid = request(res, `${res.externalReservationId}-1`);
    await expect(openPaymentRequest(db, up, { ...valid, amountMinor: 0 })).rejects.toThrow();
    await expect(openPaymentRequest(db, up, { ...valid, amountMinor: 1.5 })).rejects.toThrow();
    await expect(openPaymentRequest(db, up, { ...valid, currency: "eur" })).rejects.toThrow();
    await expect(openPaymentRequest(db, up, { ...valid, idempotencyKey: "x" })).rejects.toThrow();
    await expect(openPaymentRequest(db, up, { ...valid, returnRef: "short" })).rejects.toThrow();
    await expect(openPaymentRequest(db, { tenantId: "Not A Key!" }, valid)).rejects.toThrow(
      /tenant/,
    );
  });
});

describe("no card or link data can be stored", () => {
  it("the payment tables have no column for card data, link URLs or provider payloads", async () => {
    const tables = ["payment_requests", "reservation_payment_states", "payment_audit_events"];
    const result: unknown = await db.execute(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name IN (${sql.join(
        tables.map((name) => sql`${name}`),
        sql`, `,
      )})`,
    );
    const rows: { column_name: string }[] = Array.isArray(result)
      ? (result as { column_name: string }[])
      : (result as { rows: { column_name: string }[] }).rows;
    const columns = rows.map((row) => row.column_name).join(" ");
    expect(columns).toContain("amount_minor");
    for (const forbidden of ["card", "pan", "cvc", "url", "payload", "response", "email"]) {
      expect(columns).not.toMatch(new RegExp(`(^|_| )${forbidden}`));
    }
    // Sanity: the tables exist.
    expect(paymentRequests).toBeDefined();
    expect(reservationPaymentStates).toBeDefined();
    expect(paymentAuditEvents).toBeDefined();
  });
});
