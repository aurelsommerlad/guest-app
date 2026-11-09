/**
 * M3-D: complete booking flows through the central gateway in mode "simulated". Nothing is sent
 * to Apaleo: the in-memory double answers reads and applies the simulated commands.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createShadowEnv, CONTEXT, readReservation, type ShadowEnv } from "./test-env";

let env: ShadowEnv;
let counter = 0;
/** A fresh reservation per scenario keeps idempotency keys of other scenarios apart. */
function freshReservation(options: Parameters<ShadowEnv["reset"]>[0] = {}) {
  counter += 1;
  const reservationId = `SHADOW${String(counter).padStart(2, "0")}-1`;
  env.reset({ reservationId, ...options });
  return reservationId;
}
const key = (label: string) =>
  `order-${label}-${String(counter)}-${Math.random().toString(36).slice(2, 8)}`;
const simulatedWrites = () => env.apaleo.state.calls.filter((c) => c.method.startsWith("SIM:"));

beforeAll(async () => {
  env = await createShadowEnv();
});
afterAll(async () => {
  await env.test.close();
});

describe("catalog", () => {
  it("computes services, prices, quantities and restrictions like Extras", async () => {
    const id = freshReservation();
    const engine = env.engine();
    const reservation = await engine.getGuestCatalog(CONTEXT, await readReservation(env, id));
    const byId = Object.fromEntries(reservation.items.map((i) => [i.serviceId, i]));
    expect(reservation.items.map((i) => i.serviceId)).toEqual([
      "TEST-ECI",
      "TEST-LCO",
      "TEST-HUND",
      "TEST-PKW",
      "TEST-BABY",
      "TEST-EXTRPERSON",
    ]);
    expect(byId["TEST-ECI"]).toMatchObject({
      price: { amount: 20 },
      serviceDates: ["2027-01-12"],
      maxQuantity: null,
    });
    expect(byId["TEST-LCO"]).toMatchObject({ price: { amount: 20 }, serviceDates: ["2027-01-14"] });
    expect(byId["TEST-HUND"]).toMatchObject({
      unitPrice: { amount: 15 },
      nights: 2,
      price: { amount: 30 },
      serviceDates: ["2027-01-12", "2027-01-13"],
      maxQuantity: 1,
      alreadyBooked: false,
    });
    expect(byId["TEST-PKW"]).toMatchObject({
      requiresVehicleRegistration: true,
      price: { amount: 0 },
    });
    expect(byId["TEST-BABY"]).toMatchObject({ fulfillmentMode: "request", price: { amount: 15 } });
    expect(byId["TEST-EXTRPERSON"]).toMatchObject({
      bookingRule: "per_person_per_night",
      unitPrice: { amount: 30 },
      price: { amount: 60 },
      maxQuantity: 3,
      serviceDates: null,
    });
  });

  it("returns a past stay without calling service offers when the departure has passed", async () => {
    const id = freshReservation({ arrival: "2026-12-01", departure: "2026-12-03" });
    const engine = env.engine();
    const catalog = await engine.getGuestCatalog(CONTEXT, await readReservation(env, id));
    expect(catalog).toMatchObject({ items: [], pastStay: true });
    expect(env.apaleo.state.calls.some((c) => c.path.includes("service-offers"))).toBe(false);
  });
});

describe("M4: texts and 0 € additional guest", () => {
  it("takes missing English texts from Apaleo before falling back to German", async () => {
    const id = freshReservation();
    await env.test.client.query(
      `UPDATE offers SET title = jsonb_build_object('de', title->>'de'), teaser = jsonb_build_object('de', teaser->>'de') WHERE id = $1`,
      [env.offerIds["TEST-HUND"]],
    );
    const catalog = await env.engine().getGuestCatalog(CONTEXT, await readReservation(env, id));
    const dog = catalog.items.find((i) => i.serviceId === "TEST-HUND");
    expect(dog?.displayName).toEqual({ de: "Hund", en: "Dog fee" });
    expect(dog?.description).toEqual({ de: "Hund", en: "Dog fee" });
    // Other items keep their own English STAY text (no Apaleo read needed).
    expect(catalog.items.find((i) => i.serviceId === "TEST-ECI")?.displayName.en).toBe(
      "Early check-in",
    );
    await env.test.client.query(
      `UPDATE offers SET title = '{"de":"Hund","en":"Dog"}', teaser = '{"de":"Hund","en":"Dog"}' WHERE id = $1`,
      [env.offerIds["TEST-HUND"]],
    );
  });

  it("offers an explicitly configured 0 € additional guest and books it without surcharge", async () => {
    const id = freshReservation();
    await env.test.client.query(
      `UPDATE offer_properties SET extra_person_price_cents = 0 WHERE extras_service_id = 'TEST-EXTRPERSON'`,
    );
    const catalog = await env.engine().getGuestCatalog(CONTEXT, await readReservation(env, id));
    expect(catalog.items.find((i) => i.serviceId === "TEST-EXTRPERSON")?.price).toEqual({
      amount: 0,
      currency: "EUR",
    });
    const result = await env.engine().placeOrder(CONTEXT, {
      reservationId: id,
      idempotencyKey: key("free-guest"),
      lines: [{ serviceId: "TEST-EXTRPERSON", count: 1 }],
    });
    expect(result.status).toBe("completed");
    expect(env.apaleo.reservation(id).adults).toBe(3);
    expect(env.apaleo.reservation(id).timeSlices.map((t) => t.totalGrossAmount.amount)).toEqual([
      99, 99,
    ]);
    await env.test.client.query(
      `UPDATE offer_properties SET extra_person_price_cents = NULL WHERE extras_service_id = 'TEST-EXTRPERSON'`,
    );
    const blocked = await env.engine().getGuestCatalog(CONTEXT, await readReservation(env, id));
    expect(blocked.items.some((i) => i.serviceId === "TEST-EXTRPERSON")).toBe(false);
    expect(blocked.hidden).toContainEqual(
      expect.objectContaining({
        serviceId: "TEST-EXTRPERSON",
        reason: "invalid_extra_person_price",
      }),
    );
    await env.test.client.query(
      `UPDATE offer_properties SET extra_person_price_cents = 3000 WHERE extras_service_id = 'TEST-EXTRPERSON'`,
    );
  });
});

describe("guest orders", () => {
  it("books a multi-day dog and parking with plate in one book-service call each", async () => {
    const id = freshReservation();
    const result = await env.engine().placeOrder(CONTEXT, {
      reservationId: id,
      idempotencyKey: key("multi"),
      lines: [
        { serviceId: "TEST-HUND", count: 1 },
        { serviceId: "TEST-PKW", count: 2, vehiclePlates: ["KN-AB 1", "FN-CD 2"] },
      ],
    });
    expect(result).toMatchObject({ status: "completed", simulated: true, failed: [] });
    const booked = env.apaleo.booked(id);
    expect(
      booked.find((s) => s.service.id === "TEST-HUND")?.dates.map((d) => d.serviceDate),
    ).toEqual(["2027-01-12", "2027-01-13"]);
    expect(booked.find((s) => s.service.id === "TEST-PKW")?.dates.map((d) => d.count)).toEqual([
      2, 2,
    ]);
    expect(env.apaleo.reservation(id).primaryGuest.vehicleRegistration).toEqual({
      number: "KN-AB 1",
      countryCode: "DE",
    });
    expect(env.apaleo.reservation(id).comment).toContain(
      "Parking vehicles:\n1. KN-AB 1\n2. FN-CD 2",
    );
    expect(env.apaleo.reservation(id).comment).toMatch(/Extras gebucht: 1x Hund, 2x Parkplatz/);
    expect(simulatedWrites().map((c) => c.method)).toEqual([
      "SIM:book-service",
      "SIM:update-vehicle",
      "SIM:append-comment",
      "SIM:book-service",
      "SIM:append-comment",
    ]);
    // No HTTP write ever left the engine.
    expect(env.apaleo.writeCalls.filter((c) => !c.method.startsWith("SIM:"))).toEqual([]);
  });

  it("double click: the same key replays the stored result without a second write", async () => {
    const id = freshReservation();
    const k = key("double");
    const engine = env.engine();
    const first = await engine.placeOrder(CONTEXT, {
      reservationId: id,
      idempotencyKey: k,
      lines: [{ serviceId: "TEST-ECI", count: 1 }],
    });
    const writes = simulatedWrites().length;
    const second = await engine.placeOrder(CONTEXT, {
      reservationId: id,
      idempotencyKey: k,
      lines: [{ serviceId: "TEST-ECI", count: 1 }],
    });
    expect(first).toMatchObject({ status: "completed", replayed: false });
    expect(second).toMatchObject({
      status: "completed",
      replayed: true,
      bookingId: first.bookingId,
    });
    expect(simulatedWrites().length).toBe(writes);
  });

  it("parallel double submit with the same key: one runs, the other sees it in progress", async () => {
    const id = freshReservation();
    const k = key("parallel-same");
    const engine = env.engine();
    const [a, b] = await Promise.all([
      engine.placeOrder(CONTEXT, {
        reservationId: id,
        idempotencyKey: k,
        lines: [{ serviceId: "TEST-ECI", count: 1 }],
      }),
      engine.placeOrder(CONTEXT, {
        reservationId: id,
        idempotencyKey: k,
        lines: [{ serviceId: "TEST-ECI", count: 1 }],
      }),
    ]);
    expect([a.status, b.status].sort()).toEqual(["completed", "in_progress"]);
    expect(simulatedWrites().filter((c) => c.method === "SIM:book-service")).toHaveLength(1);
  });

  it("concurrent dog bookings from two tabs: exactly one dog is booked", async () => {
    const id = freshReservation();
    const engine = env.engine();
    const results = await Promise.all(
      ["tab-a", "tab-b"].map((tab) =>
        engine.placeOrder(CONTEXT, {
          reservationId: id,
          idempotencyKey: key(tab),
          lines: [{ serviceId: "TEST-HUND", count: 1 }],
        }),
      ),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === "completed")).toHaveLength(1);
    const loser = results.find((r) => r.status === "failed");
    expect(loser && "failed" in loser && loser.failed[0]?.reason).toMatch(
      /dog_limit_exceeded|in_progress/,
    );
    expect(env.apaleo.booked(id).filter((s) => s.service.id === "TEST-HUND")).toHaveLength(1);
    // A later order sees the booked dog (fresh Apaleo read).
    const again = await engine.placeOrder(CONTEXT, {
      reservationId: id,
      idempotencyKey: key("tab-c"),
      lines: [{ serviceId: "TEST-HUND", count: 1 }],
    });
    expect(again).toMatchObject({ status: "failed", failed: [{ reason: "dog_limit_exceeded" }] });
  });

  it("concurrent extra-person selections from two tabs never exceed the remaining capacity", async () => {
    // 2 adults + 1 child in a unit for 6 → 3 places left; both tabs want 2.
    const id = freshReservation();
    const engine = env.engine();
    const results = await Promise.all(
      ["cart-a", "cart-b"].map((tab) =>
        engine.placeOrder(CONTEXT, {
          reservationId: id,
          idempotencyKey: key(tab),
          lines: [{ serviceId: "TEST-EXTRPERSON", count: 2 }],
        }),
      ),
    );
    expect(results.filter((r) => r.status === "completed")).toHaveLength(1);
    expect(env.apaleo.state.reservations[id]?.adults).toBe(4);
    // The rest of the capacity (1) is still bookable, more is refused.
    const over = await engine.placeOrder(CONTEXT, {
      reservationId: id,
      idempotencyKey: key("cart-c"),
      lines: [{ serviceId: "TEST-EXTRPERSON", count: 2 }],
    });
    expect(over.status).toBe("failed");
    const rest = await engine.placeOrder(CONTEXT, {
      reservationId: id,
      idempotencyKey: key("cart-d"),
      lines: [{ serviceId: "TEST-EXTRPERSON", count: 1 }],
    });
    expect(rest.status).toBe("completed");
    expect(env.apaleo.state.reservations[id]?.adults).toBe(5);
  });

  it("price change between display and booking fails the line instead of booking the new price", async () => {
    const id = freshReservation();
    env.apaleo.state.priceOverrides["TEST-ECI"] = 25;
    const result = await env.engine().placeOrder(CONTEXT, {
      reservationId: id,
      idempotencyKey: key("price"),
      lines: [{ serviceId: "TEST-ECI", count: 1, expectedUnitPrice: 20 }],
    });
    expect(result).toMatchObject({
      status: "failed",
      failed: [{ serviceId: "TEST-ECI", reason: "price_changed" }],
    });
    expect(simulatedWrites()).toEqual([]);
    // Without an expected price the live price is booked (Extras behaviour).
    const accepted = await env.engine().placeOrder(CONTEXT, {
      reservationId: id,
      idempotencyKey: key("price-live"),
      lines: [{ serviceId: "TEST-ECI", count: 1 }],
    });
    expect(accepted.status).toBe("completed");
    expect(
      env.apaleo.booked(id).find((s) => s.service.id === "TEST-ECI")?.dates[0]?.amount.grossAmount,
    ).toBe(25);
  });

  it("partially failed order: valid lines book, invalid and failing lines are reported", async () => {
    const id = freshReservation();
    // The catalog read succeeds; the fresh dog check under the claim fails (Apaleo 503, retried once).
    let servicesReads = 0;
    env.apaleo.beforeRequest = (method, path) => {
      if (
        method === "GET" &&
        path.endsWith(`/reservations/${id}/services`) &&
        ++servicesReads === 2
      )
        env.apaleo.failures.push({
          method: "GET",
          pathIncludes: `/reservations/${id}/services`,
          status: 503,
          times: 2,
        });
    };
    const result = await env.engine().placeOrder(CONTEXT, {
      reservationId: id,
      idempotencyKey: key("partial"),
      lines: [
        { serviceId: "TEST-ECI", count: 1 },
        { serviceId: "TEST-PKW", count: 1 },
        { serviceId: "TEST-HUND", count: 1 },
        { serviceId: "TEST-BABY", count: 1 },
      ],
    });
    expect(result.status).toBe("partial");
    expect(result.status !== "in_progress" && result.failed).toEqual([
      { serviceId: "TEST-PKW", reason: "vehicle_registration_required" },
      { serviceId: "TEST-HUND", reason: "apaleo_unavailable" },
      { serviceId: "TEST-BABY", reason: "not_available" },
    ]);
    const rows = await env.test.client.query<{ status: string; total_cents: number }>(
      `SELECT status, total_cents FROM service_bookings WHERE external_reservation_id = $1`,
      [id],
    );
    expect(rows.rows).toEqual([{ status: "partial", total_cents: 2000 }]);
  });

  it("retry after an abort resumes the same order once the lease has expired", async () => {
    const id = freshReservation();
    const k = key("resume");
    const { createServiceRecordStore } = await import("@up/db");
    const store = createServiceRecordStore(env.db);
    const aborted = await store.beginBooking({
      tenantId: CONTEXT.tenantId,
      propertyId: CONTEXT.propertyId,
      externalReservationId: id,
      idempotencyKey: k,
      now: new Date("2027-01-05T09:00:00Z"),
      leaseMs: 120_000,
    });
    expect(aborted.kind).toBe("new");
    const early = env.engine({ now: new Date("2027-01-05T09:01:00Z") });
    expect(
      await early.placeOrder(CONTEXT, {
        reservationId: id,
        idempotencyKey: k,
        lines: [{ serviceId: "TEST-ECI", count: 1 }],
      }),
    ).toEqual({
      status: "in_progress",
      bookingId: aborted.id,
    });
    const later = await env.engine().placeOrder(CONTEXT, {
      reservationId: id,
      idempotencyKey: k,
      lines: [{ serviceId: "TEST-ECI", count: 1 }],
    });
    expect(later).toMatchObject({ status: "completed", bookingId: aborted.id });
  });

  it("reservation changes are picked up at booking time (fresh read, unit group restriction)", async () => {
    const id = freshReservation();
    // Stay extended by staff after the guest loaded the page: the dog covers all three nights.
    env.apaleo.reservation(id).departure = "2027-01-15T10:00:00+01:00";
    const result = await env.engine().placeOrder(CONTEXT, {
      reservationId: id,
      idempotencyKey: key("changed"),
      lines: [{ serviceId: "TEST-HUND", count: 1 }],
    });
    expect(result.status).toBe("completed");
    expect(env.apaleo.booked(id).find((s) => s.service.id === "TEST-HUND")?.dates).toHaveLength(3);
    // Apartment type no longer allowed for parking.
    await env.test.client.query(
      `UPDATE offer_properties SET allowed_unit_group_ids = '{TEST-OTHER}' WHERE extras_service_id = 'TEST-PKW'`,
    );
    const restricted = await env.engine().placeOrder(CONTEXT, {
      reservationId: id,
      idempotencyKey: key("restricted"),
      lines: [{ serviceId: "TEST-PKW", count: 1, vehiclePlates: ["KN-X 1"] }],
    });
    expect(restricted).toMatchObject({ failed: [{ reason: "unit_group_restricted" }] });
    await env.test.client.query(
      `UPDATE offer_properties SET allowed_unit_group_ids = '{}' WHERE extras_service_id = 'TEST-PKW'`,
    );
  });

  it("additional guests amend the reservation within the remaining capacity only", async () => {
    const id = freshReservation();
    const tooMany = await env.engine().placeOrder(CONTEXT, {
      reservationId: id,
      idempotencyKey: key("occ-4"),
      lines: [{ serviceId: "TEST-EXTRPERSON", count: 4 }],
    });
    expect(tooMany).toMatchObject({ status: "failed", failed: [{ reason: "capacity_exceeded" }] });
    const ok = await env.engine().placeOrder(CONTEXT, {
      reservationId: id,
      idempotencyKey: key("occ-2"),
      lines: [{ serviceId: "TEST-EXTRPERSON", count: 2 }],
    });
    expect(ok.status).toBe("completed");
    const r = env.apaleo.reservation(id);
    expect(r.adults).toBe(4);
    expect(r.timeSlices.map((s) => s.totalGrossAmount.amount)).toEqual([159, 159]);
  });

  it("with writes disabled nothing is booked and the code is reported", async () => {
    const id = freshReservation();
    const result = await env.engine({ mode: "disabled" }).placeOrder(CONTEXT, {
      reservationId: id,
      idempotencyKey: key("disabled"),
      lines: [{ serviceId: "TEST-ECI", count: 1 }],
    });
    expect(result).toMatchObject({
      status: "failed",
      failed: [{ reason: "booking_failed:writes_disabled" }],
    });
    expect(env.apaleo.booked(id)).toHaveLength(1); // only the mandatory final cleaning
  });
});

describe("stay extension", () => {
  it("offers the next night with the pre-arrival standard discount and the extended extras", async () => {
    const id = freshReservation();
    await env.engine().placeOrder(CONTEXT, {
      reservationId: id,
      idempotencyKey: key("ext-dog"),
      lines: [{ serviceId: "TEST-HUND", count: 1 }],
    });
    const offer = await env.engine().getStayExtensionOffer(CONTEXT, id);
    expect(offer).toMatchObject({
      currentDeparture: "2027-01-14",
      newDeparture: "2027-01-15",
      phase: "before_arrival",
      gap: 3,
      discountPercent: 10,
      extensionPrice: { amount: 89.1 },
      extras: [{ serviceId: "TEST-HUND", amount: { amount: 15 } }],
      totalPrice: { amount: 104.1 },
    });
  });

  it("extends with an existing Late Check-out: night added, dog extended, Late Check-out moved", async () => {
    const id = freshReservation();
    await env.engine().placeOrder(CONTEXT, {
      reservationId: id,
      idempotencyKey: key("ext-lco"),
      lines: [
        { serviceId: "TEST-HUND", count: 1 },
        { serviceId: "TEST-LCO", count: 1 },
      ],
    });
    const result = await env
      .engine()
      .confirmStayExtension(CONTEXT, { reservationId: id, expectedCurrentDeparture: "2027-01-14" });
    expect(result).toMatchObject({ ok: true, newDeparture: "2027-01-15", status: "confirmed" });
    const r = env.apaleo.reservation(id);
    expect(r.departure.slice(0, 10)).toBe("2027-01-15");
    expect(r.timeSlices.map((s) => s.totalGrossAmount.amount)).toEqual([99, 99, 89.1]);
    const booked = env.apaleo.booked(id);
    expect(
      booked.find((s) => s.service.id === "TEST-HUND")?.dates.map((d) => d.serviceDate),
    ).toEqual(["2027-01-12", "2027-01-13", "2027-01-14"]);
    expect(
      booked.find((s) => s.service.id === "TEST-LCO")?.dates.map((d) => d.serviceDate),
    ).toEqual(["2027-01-15"]);
    expect(booked.find((s) => s.service.id === "TEST-FINALCLEAN")?.dates[0]?.serviceDate).toBe(
      "2027-01-14",
    );
    const rows = await env.test.client.query<{
      status: string;
      total_additional_cents: number;
      details: { lateCheckoutMoves: { verified: boolean }[] };
    }>(
      `SELECT status, total_additional_cents, details FROM stay_extensions WHERE external_reservation_id = $1`,
      [id],
    );
    expect(rows.rows[0]).toMatchObject({ status: "confirmed", total_additional_cents: 10410 });
    expect(rows.rows[0]?.details.lateCheckoutMoves[0]?.verified).toBe(true);
    // A second confirmation (double click / retry) is refused: the departure has moved.
    expect(
      await env.engine().confirmStayExtension(CONTEXT, {
        reservationId: id,
        expectedCurrentDeparture: "2027-01-14",
      }),
    ).toEqual({
      ok: false,
      reason: "stay_extension_unavailable",
    });
  });

  it("no offer when the night is sold out, AmendDeparture is not allowed or no safe unit", async () => {
    let id = freshReservation();
    env.apaleo.state.soldOut.push("2027-01-14");
    expect(await env.engine().getStayExtensionOffer(CONTEXT, id)).toBeNull();
    id = freshReservation({ amendDepartureAllowed: false });
    expect(await env.engine().getStayExtensionOffer(CONTEXT, id)).toBeNull();
    id = freshReservation({ unitId: null, physicalCount: 2 });
    expect(await env.engine().getStayExtensionOffer(CONTEXT, id)).toBeNull();
    id = freshReservation({ unitId: null, physicalCount: 1 });
    expect(await env.engine().getStayExtensionOffer(CONTEXT, id)).not.toBeNull();
  });

  it("without a state double (staging) the result is stored as not verifiable, never as verified", async () => {
    const id = freshReservation();
    const result = await env
      .engine({ apply: false })
      .confirmStayExtension(CONTEXT, { reservationId: id, expectedCurrentDeparture: "2027-01-14" });
    expect(result).toMatchObject({ ok: true, simulated: true, status: "confirmed" });
    const rows = await env.test.client.query<{
      new_departure_confirmed: boolean;
      details: { verification: string };
    }>(
      `SELECT new_departure_confirmed, details FROM stay_extensions WHERE external_reservation_id = $1`,
      [id],
    );
    expect(rows.rows[0]).toMatchObject({
      new_departure_confirmed: false,
      details: { verification: "skipped_simulated" },
    });
  });
});

describe("requests", () => {
  it("creates a request, confirms it once with all dates, refuses a second decision", async () => {
    const id = freshReservation();
    const engine = env.engine();
    const created = await engine.createRequest(CONTEXT, {
      reservationId: id,
      serviceId: "TEST-BABY",
      quantity: 1,
    });
    expect(created).toMatchObject({ ok: true });
    const requestId = created.ok ? created.requestId : "";
    expect(
      await engine.createRequest(CONTEXT, {
        reservationId: id,
        serviceId: "TEST-ECI",
        quantity: 1,
      }),
    ).toEqual({ ok: false, reason: "not_available" });
    const approved = await engine.approveRequest(CONTEXT, requestId, env.ownerId);
    expect(approved).toMatchObject({ ok: true, alreadyBooked: false, simulated: true });
    expect(
      env.apaleo
        .booked(id)
        .find((s) => s.service.id === "TEST-BABY")
        ?.dates.map((d) => d.serviceDate),
    ).toEqual(["2027-01-12"]);
    expect(env.apaleo.reservation(id).comment).toMatch(/Anfrage bestätigt: 1x Babybett/);
    expect(await engine.approveRequest(CONTEXT, requestId, env.ownerId)).toEqual({
      ok: false,
      reason: "not_pending",
    });
    expect(await engine.rejectRequest(CONTEXT, requestId, env.ownerId)).toEqual({
      ok: false,
      reason: "not_pending",
    });
    const outbox = await env.test.client.query<{ template: string; status: string }>(
      `SELECT template, status FROM notification_outbox WHERE dedup_key = $1`,
      [`service-request:${requestId}`],
    );
    expect(outbox.rows).toEqual([{ template: "service.request", status: "pending" }]);
  });

  it("rejection with reason, insufficient availability and disabled writes keep Apaleo untouched", async () => {
    const id = freshReservation();
    const engine = env.engine();
    const a = await engine.createRequest(CONTEXT, {
      reservationId: id,
      serviceId: "TEST-BABY",
      quantity: 1,
    });
    if (!a.ok) throw new Error("request a not created");
    // A second open request for the same service is refused when it is made (M4).
    expect(
      await engine.createRequest(CONTEXT, {
        reservationId: id,
        serviceId: "TEST-BABY",
        quantity: 1,
      }),
    ).toEqual({
      ok: false,
      reason: "already_requested",
    });
    expect(
      await engine.rejectRequest(CONTEXT, a.requestId, env.ownerId, "Kein Babybett frei"),
    ).toEqual({ ok: true });
    const b = await engine.createRequest(CONTEXT, {
      reservationId: id,
      serviceId: "TEST-BABY",
      quantity: 2,
    });
    if (!b.ok) throw new Error("request b not created");
    env.apaleo.state.availability["TEST-BABY"] = { "2027-01-12": 1 };
    expect(await engine.approveRequest(CONTEXT, b.requestId, env.ownerId)).toEqual({
      ok: false,
      reason: "insufficient_availability",
    });
    expect(
      await env.engine({ mode: "disabled" }).approveRequest(CONTEXT, b.requestId, env.ownerId),
    ).toEqual({
      ok: false,
      reason: "insufficient_availability",
    });
    env.apaleo.state.availability = {};
    expect(
      await env.engine({ mode: "disabled" }).approveRequest(CONTEXT, b.requestId, env.ownerId),
    ).toEqual({
      ok: false,
      reason: "booking_failed:writes_disabled",
    });
    const rows = await env.test.client.query<{
      id: string;
      status: string;
      decision_reason: string | null;
    }>(
      `SELECT id, status, decision_reason FROM offer_requests WHERE external_reservation_id = $1`,
      [id],
    );
    expect(Object.fromEntries(rows.rows.map((r) => [r.id, [r.status, r.decision_reason]]))).toEqual(
      {
        [a.requestId]: ["declined", "Kein Babybett frei"],
        [b.requestId]: ["pending", null],
      },
    );
    expect(env.apaleo.booked(id).some((s) => s.service.id === "TEST-BABY")).toBe(false);
    const audit = await env.test.client.query<{ action: string; details: Record<string, unknown> }>(
      `SELECT action, details FROM admin_audit_events WHERE entity_id = $1`,
      [a.requestId],
    );
    expect(audit.rows).toEqual([{ action: "request.declined", details: { reasonGiven: true } }]);
  });

  it("checks quantity and availability when the request is made; a repeated submit returns the same request", async () => {
    const id = freshReservation();
    const engine = env.engine();
    env.apaleo.state.availability["TEST-BABY"] = { "2027-01-12": 1 };
    expect(
      await engine.createRequest(CONTEXT, {
        reservationId: id,
        serviceId: "TEST-BABY",
        quantity: 2,
      }),
    ).toEqual({
      ok: false,
      reason: "insufficient_availability",
    });
    const keyA = `req-${String(counter)}-same-key`;
    const first = await engine.createRequest(CONTEXT, {
      reservationId: id,
      serviceId: "TEST-BABY",
      quantity: 1,
      idempotencyKey: keyA,
    });
    const again = await engine.createRequest(CONTEXT, {
      reservationId: id,
      serviceId: "TEST-BABY",
      quantity: 1,
      idempotencyKey: keyA,
    });
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(again).toMatchObject({
      ok: true,
      replayed: true,
      requestId: first.ok ? first.requestId : "",
    });
    const outbox = await env.test.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notification_outbox WHERE dedup_key = $1`,
      [`service-request:${first.ok ? first.requestId : ""}`],
    );
    expect(outbox.rows[0]?.n).toBe(1);
  });

  it("never confirms a changed price silently; the team must accept the current price", async () => {
    const id = freshReservation();
    const engine = env.engine();
    const created = await engine.createRequest(CONTEXT, {
      reservationId: id,
      serviceId: "TEST-BABY",
      quantity: 1,
    });
    if (!created.ok) throw new Error("not created");
    env.apaleo.state.priceOverrides["TEST-BABY"] = 18;
    const preview = await engine.previewRequestApproval(CONTEXT, created.requestId);
    expect(preview).toMatchObject({
      ok: true,
      bookable: true,
      priceChanged: true,
      quotedCents: 1500,
      currentCents: 1800,
      dates: ["2027-01-12"],
      existing: "none",
    });
    expect(await engine.approveRequest(CONTEXT, created.requestId, env.ownerId)).toEqual({
      ok: false,
      reason: "price_changed",
      currentCents: 1800,
    });
    expect(
      await engine.approveRequest(CONTEXT, created.requestId, env.ownerId, {
        acceptedPriceCents: 1500,
      }),
    ).toEqual({ ok: false, reason: "price_changed", currentCents: 1800 });
    expect(env.apaleo.booked(id).some((s) => s.service.id === "TEST-BABY")).toBe(false);
    expect(
      await engine.approveRequest(CONTEXT, created.requestId, env.ownerId, {
        acceptedPriceCents: 1800,
      }),
    ).toMatchObject({ ok: true, priceCents: 1800 });
    expect(
      env.apaleo.booked(id).find((s) => s.service.id === "TEST-BABY")?.dates[0]?.amount.grossAmount,
    ).toBe(18);
  });

  it("parallel decisions: exactly one approval books, the other is refused", async () => {
    const id = freshReservation();
    const created = await env
      .engine()
      .createRequest(CONTEXT, { reservationId: id, serviceId: "TEST-BABY", quantity: 1 });
    if (!created.ok) throw new Error("not created");
    const results = await Promise.all([
      env.engine().approveRequest(CONTEXT, created.requestId, env.ownerId),
      env.engine().approveRequest(CONTEXT, created.requestId, env.ownerId),
      env.engine().rejectRequest(CONTEXT, created.requestId, env.ownerId),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      env.apaleo.state.calls.filter((c) => c.method === "SIM:book-service").length,
    ).toBeLessThanOrEqual(1);
  });

  it("imported Extras requests cannot be decided in STAY", async () => {
    const id = freshReservation();
    const row = await env.test.client.query<{ id: string }>(
      `INSERT INTO offer_requests (tenant_id, offer_id, property_id, reservation_provider, external_reservation_id, source, legacy_id,
         quantity, apaleo_service_id, requested_dates)
       VALUES ($1, $2, $3, 'apaleo', $4, 'extras', 'extras-req-1', 1, 'TEST-BABY', '{2027-01-12}') RETURNING id`,
      [CONTEXT.tenantId, env.offerIds["TEST-BABY"], CONTEXT.propertyId, id],
    );
    const requestId = row.rows[0]?.id ?? "";
    expect(await env.engine().approveRequest(CONTEXT, requestId, env.ownerId)).toEqual({
      ok: false,
      reason: "handled_in_extras",
    });
    expect(await env.engine().rejectRequest(CONTEXT, requestId, env.ownerId)).toEqual({
      ok: false,
      reason: "handled_in_extras",
    });
  });

  it("requests of another property are invisible to this property's engine", async () => {
    const id = freshReservation();
    const created = await env
      .engine()
      .createRequest(CONTEXT, { reservationId: id, serviceId: "TEST-BABY", quantity: 1 });
    if (!created.ok) throw new Error("not created");
    const other = { ...CONTEXT, propertyId: "hov" };
    expect(await env.engine().approveRequest(other, created.requestId, env.ownerId)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});
