/**
 * Configuration parity Extras → STAY: every stored value case (absent, "", null, 0, "0",
 * false, "false", true, "true", odd numbers and lists), what Extras does with it, what the import
 * stores, and – against a real database – that the stored STAY row equals the planned value,
 * a repeated import changes nothing and STAY edits are never overwritten.
 */
import {
  extrasExtensionConfig,
  extrasExtensionEffectivelyEnabled,
  normalizeBoolean,
  SORT_ORDER_LAST,
} from "@up/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database } from "../client";
import { seedTenant } from "../seed/seed-tenant";
import { uniquePlacesSeed } from "../seed/unique-places";
import { createTestDatabase, type TestDatabase } from "../testing/test-database";
import { compareExtrasConfiguration, renderConfigParityMarkdown } from "./config-parity";
import { planImageMigration } from "./images";
import {
  configWithWarnings,
  type ExtrasSnapshotLike,
  extrasTextsOf,
  importExtrasSnapshot,
  mapExtensionSettings,
  UNMATCHABLE_UNIT_GROUP,
} from "./importer";

const ABSENT = Symbol("absent");
/** Every stored shape the acceptance asks for. */
const STORED_CASES: unknown[] = [ABSENT, "", null, undefined, 0, "0", false, "false", true, "true"];

const base = (serviceId: string, extra: Record<string, unknown> = {}) => ({
  serviceId,
  code: serviceId.split("-")[1] ?? serviceId,
  active: true,
  bookingRule: "per_stay",
  fulfillmentMode: "instant",
  actionType: "service",
  sortOrder: 1,
  ...extra,
});
const withField = (item: Record<string, unknown>, key: string, value: unknown) => {
  if (value !== ABSENT) return { ...item, [key]: value };
  return Object.fromEntries(Object.entries(item).filter(([k]) => k !== key));
};
/** JSON.stringify returns undefined for undefined at runtime (its type says string). */
const label = (value: unknown): string =>
  value === undefined ? "undefined" : JSON.stringify(value);
const snap = (data: Record<string, unknown>): ExtrasSnapshotLike => ({
  entries: Object.entries(data).map(([key, value]) => ({
    key,
    type: key.endsWith(":items") || key.endsWith(":records") ? "hash" : "string",
    value,
  })),
});

describe("default values – booleans (P-1)", () => {
  for (const key of [
    "active",
    "requiresRemainingCapacity",
    "requiresVehicleRegistration",
    "maxOnePerReservation",
  ]) {
    for (const value of STORED_CASES) {
      it(`${key} = ${value === ABSENT ? "(fehlt)" : label(value)}`, () => {
        const item = withField(base("X-A"), key, value);
        const { config, warnings } = configWithWarnings(item);
        const extras = Boolean(value === ABSENT ? undefined : value);
        const stay = normalizeBoolean(value === ABSENT ? undefined : value).value;
        expect(config[key as "active"]).toBe(stay);
        // A different meaning is never silent.
        expect(warnings.includes(`p1_boolean_differs:${key}`)).toBe(extras !== stay);
        const report = compareExtrasConfiguration(snap({ "catalog:P:items": { "X-A": item } }), {
          basis: "synthetic",
        });
        const field = report.properties[0]?.services[0]?.fields.find((f) => f.field === key);
        expect(field?.category).toBe(extras === stay ? "identical" : "intended");
        expect(report.affected.p1.some((p) => p.field === key)).toBe(extras !== stay);
      });
    }
  }

  it("only the strings 'false' and '0' differ among the required cases", () => {
    const differing = STORED_CASES.filter((value) => {
      const v = value === ABSENT ? undefined : value;
      return Boolean(v) !== normalizeBoolean(v).value;
    });
    expect(differing).toEqual(["0", "false"]);
  });
});

describe("default values – additional guest price (P-2)", () => {
  const cases: [unknown, number | null, number | null][] = [
    // stored, Extras (€ or hidden), STAY (cents or blocked)
    [ABSENT, null, null],
    ["", 0, null],
    [null, 0, null],
    [undefined, null, null],
    [0, 0, 0],
    ["0", 0, 0],
    [false, 0, null],
    [true, 1, null],
    ["35", 35, 3500],
    [35.5, 35.5, 3550],
    ["35,50", null, 3550],
    [-1, null, null],
    ["abc", null, null],
  ];
  for (const [stored, extras, stay] of cases) {
    it(`extraPersonPricePerNight = ${stored === ABSENT ? "(fehlt)" : label(stored)}`, () => {
      const item = withField(
        base("X-EXTRPERSON", {
          actionType: "increase_occupancy",
          requiresRemainingCapacity: true,
        }),
        "extraPersonPricePerNight",
        stored,
      );
      const { config, warnings } = configWithWarnings(item);
      expect(config.extraPersonPriceCents).toBe(stay);
      const differs = (extras === null ? null : Math.round(extras * 100)) !== stay;
      expect(warnings.includes("p2_extra_person_price_differs")).toBe(differs);
      const report = compareExtrasConfiguration(
        snap({ "catalog:P:items": { "X-EXTRPERSON": item } }),
        { basis: "synthetic" },
      );
      expect(report.affected.p2.length).toBe(differs ? 1 : 0);
    });
  }
});

describe("default values – extension night", () => {
  it("absent config: Extras defaults, switched off", () => {
    const { values, notes } = mapExtensionSettings({});
    expect(values).toEqual({
      extensionNightEnabled: false,
      discountPreArrivalOneNightGap: 15,
      discountPreArrivalStandard: 10,
      discountInHouseOneNightGap: 20,
      discountInHouseStandard: 15,
      minSellableStayNights: 2,
    });
    expect(notes).toEqual([]);
  });

  for (const value of STORED_CASES) {
    it(`extensionNightEnabled = ${value === ABSENT ? "(fehlt)" : label(value)}`, () => {
      const stored = withField({ minSellableStayNights: 2 }, "extensionNightEnabled", value);
      const { values, notes } = mapExtensionSettings(stored);
      const extras = extrasExtensionConfig(stored).extensionNightEnabled;
      expect(values.extensionNightEnabled).toBe(
        normalizeBoolean(value === ABSENT ? undefined : value).value,
      );
      expect(notes.includes("p1_boolean_differs:extensionNightEnabled")).toBe(
        extras !== values.extensionNightEnabled,
      );
    });
  }

  // Extras answers "invalid_config" (no offer) for a minimum below 1 – also for null, "" and 0.
  const minCases: [unknown, boolean, number][] = [
    // stored minimum, STAY switch (Extras switch is on), STAY minimum
    [ABSENT, true, 2],
    [null, false, 2],
    ["", false, 2],
    [0, false, 2],
    ["0", false, 2],
    [-1, false, 2],
    [false, false, 2],
    [true, true, 1],
    ["abc", true, 2],
    [1, true, 1],
    [2.5, true, 2],
    [3, true, 3],
    [50, true, 30],
  ];
  for (const [stored, enabled, min] of minCases) {
    it(`minSellableStayNights = ${stored === ABSENT ? "(fehlt)" : JSON.stringify(stored)}`, () => {
      const config = withField({ extensionNightEnabled: true }, "minSellableStayNights", stored);
      const { values, notes } = mapExtensionSettings(config);
      expect(values.extensionNightEnabled).toBe(enabled);
      expect(values.minSellableStayNights).toBe(min);
      // Extras' own effect is preserved; a changed one is always reported.
      const extrasEffective = extrasExtensionEffectivelyEnabled(extrasExtensionConfig(config));
      expect(values.extensionNightEnabled).toBe(extrasEffective);
      if (!enabled) expect(notes).toContain("extension_off_invalid_min_in_extras");
      if (stored === 50) expect(notes).toContain("min_nights_clamped");
      if (stored === 2.5) expect(notes).toContain("min_nights_floored_same_decisions");
    });
  }

  it("floor keeps every gap decision of a fractional minimum", () => {
    for (const gap of [0, 1, 2, 3, 4]) {
      expect(gap > 2.5).toBe(gap > Math.floor(2.5));
    }
  });

  const discountCases: [unknown, number, string | null][] = [
    [ABSENT, 15, null],
    [null, 0, null],
    ["", 0, null],
    [0, 0, null],
    ["0", 0, null],
    [false, 0, null],
    [true, 1, null],
    ["15", 15, null],
    [12.5, 13, "discount_rounded"],
    [100, 90, "discount_clamped"],
    [-5, 0, "discount_clamped"],
    ["abc", 15, null],
  ];
  for (const [stored, expected, note] of discountCases) {
    it(`discount = ${stored === ABSENT ? "(fehlt)" : JSON.stringify(stored)}`, () => {
      const config = withField(
        { extensionNightEnabled: true },
        "extensionDiscountPreArrivalOneNightGap",
        stored,
      );
      const { values, notes } = mapExtensionSettings(config);
      expect(values.discountPreArrivalOneNightGap).toBe(expected);
      if (note) expect(notes).toContain(`${note}:extensionDiscountPreArrivalOneNightGap`);
      else expect(notes.some((n) => n.startsWith("discount_"))).toBe(false);
    });
  }

  it("all four discounts fall back to the legacy flat fields, then to the defaults", () => {
    const { values } = mapExtensionSettings({
      extensionDiscountOneNightGap: 25,
      extensionDiscountStandard: 5,
      extensionDiscountInHouseStandard: 7,
    });
    expect(values).toMatchObject({
      discountPreArrivalOneNightGap: 25,
      discountInHouseOneNightGap: 25,
      discountPreArrivalStandard: 5,
      discountInHouseStandard: 7,
    });
  });
});

describe("rules that Extras could store but STAY cannot represent 1:1", () => {
  it("unknown booking mode: hidden in Extras, imported inactive", () => {
    for (const mode of ["Request", "manual", "link"]) {
      const { config, warnings } = configWithWarnings(base("X-M", { fulfillmentMode: mode }));
      expect(config.active).toBe(false);
      expect(warnings).toContain("unknown_fulfillment_hidden_in_extras");
    }
    for (const mode of ["", null, undefined, "instant"]) {
      const { config } = configWithWarnings(base("X-M", { fulfillmentMode: mode }));
      expect(config).toMatchObject({ active: true, fulfillment: "instant" });
    }
    expect(configWithWarnings(base("X-M", { fulfillmentMode: "request" })).config.fulfillment).toBe(
      "request",
    );
  });

  it("apartment types: unrestricted, restricted, unmatchable and too many", () => {
    const groups = (value: unknown) =>
      configWithWarnings(base("X-U", { allowedUnitGroupIds: value }));
    expect(groups(undefined).config.allowedUnitGroupIds).toEqual([]);
    expect(groups([]).config.allowedUnitGroupIds).toEqual([]);
    expect(groups("UG1").config.allowedUnitGroupIds).toEqual([]); // Extras: not an array = all
    expect(groups(["UG1", " UG2 "]).config.allowedUnitGroupIds).toEqual(["UG1", "UG2"]);
    // Extras restricts to entries that never match – STAY must not open it to all types.
    for (const value of [["bad id!"], [123], [""]]) {
      const r = groups(value);
      expect(r.config.allowedUnitGroupIds).toEqual([UNMATCHABLE_UNIT_GROUP]);
      expect(r.warnings).toContain("unit_groups_unmatchable_kept_restricted");
    }
    const many = groups(Array.from({ length: 51 }, (_, i) => `UG${String(i)}`));
    expect(many.config.allowedUnitGroupIds).toHaveLength(50);
    expect(many.warnings).toContain("unit_group_ids_truncated");
  });

  it("sort order: numbers kept, fractions rounded, text and empty sorted last as in Extras", () => {
    const order = (value: unknown) => configWithWarnings(base("X-S", { sortOrder: value }));
    expect(order(3).config.sortOrder).toBe(3);
    expect(order(0).config.sortOrder).toBe(0);
    expect(order(null).config.sortOrder).toBe(SORT_ORDER_LAST);
    expect(order(undefined).config.sortOrder).toBe(SORT_ORDER_LAST);
    expect(order("").config.sortOrder).toBe(SORT_ORDER_LAST);
    expect(order("3").config.sortOrder).toBe(SORT_ORDER_LAST);
    expect(order("3").warnings).toContain("sort_order_not_a_number");
    expect(order(2.5).config.sortOrder).toBe(3);
    expect(order(2.5).warnings).toContain("sort_order_rounded");
    expect(order(20_000).warnings).toContain("sort_order_outside_admin_range");
  });

  it("visible order is compared per property", () => {
    const report = compareExtrasConfiguration(
      snap({
        "catalog:P:items": {
          "X-A": base("X-A", { sortOrder: null }),
          "X-B": base("X-B", { sortOrder: 2 }),
          "X-C": base("X-C", { sortOrder: "1" }),
          "X-D": base("X-D", { sortOrder: 1, active: false }),
        },
      }),
      { basis: "synthetic" },
    );
    const order = report.properties[0]?.order;
    expect(order?.extras).toEqual(["X-B", "X-A", "X-C"]);
    expect(order?.stay).toEqual(["X-B", "X-A", "X-C"]);
    // X-A and X-C both sort last – ties are reported as not verified.
    expect(order?.category).toBe("unverified");
  });

  it("Extras text fields are carried verbatim for Extras' text logic", () => {
    expect(
      extrasTextsOf({
        displayName: " Car park ",
        displayNameDe: "",
        description: "Tiefgarage",
        priceUnitLabel: "pro Stellplatz",
        code: "PKW",
        name: "ignored",
      }),
    ).toEqual({
      displayName: "Car park",
      description: "Tiefgarage",
      priceUnitLabel: "pro Stellplatz",
      code: "PKW",
    });
  });

  it("unknown stored fields are listed, never dropped silently", () => {
    const report = compareExtrasConfiguration(
      snap({
        "catalog:P:items": { "X-A": base("X-A", { price: 12 }) },
        "extension-night:config:P": { extensionNightEnabled: true, maxNights: 3 },
      }),
      { basis: "synthetic" },
    );
    expect(report.unknownFields).toEqual([
      { reference: "P:X-A", field: "price" },
      { reference: "P:extension", field: "maxNights" },
    ]);
  });
});

describe("images", () => {
  const ID = "22222222-2222-4222-8222-222222222222";
  it("legacy array catalogs and external addresses are covered", () => {
    const s = snap({
      // Legacy single-array catalog (before the hash migration in Extras).
      "catalog:OLD": [base("OLD-A", { imageUrl: `/api/images/${ID}` })],
      "catalog:P:items": { "X-A": base("X-A", { imageUrl: "https://cdn.example/a.jpg" }) },
      [`image:${ID}`]: { contentType: "image/jpeg", base64: "AAAA" },
    });
    const plan = planImageMigration(s);
    expect(plan[0]?.references).toEqual(["OLD:OLD-A"]);
    const report = compareExtrasConfiguration(s, { basis: "synthetic" });
    expect(report.images.external).toEqual([
      { reference: "P:X-A", url: "https://cdn.example/a.jpg" },
    ]);
    const field = report.properties
      .find((p) => p.apaleoPropertyId === "P")
      ?.services[0]?.fields.find((f) => f.field === "imageUrl");
    expect(field?.category).toBe("missing");
  });
});

describe("report", () => {
  it("is marked synthetic and lists operational findings without personal data", () => {
    const report = compareExtrasConfiguration(
      snap({
        users: [{ id: "u1", username: "someone@example.test", role: "admin" }],
        "catalog:P:items": { "X-R": base("X-R", { fulfillmentMode: "request" }) },
        "requests:items": { r1: { requestId: "r1", status: "pending" } },
      }),
      { basis: "synthetic" },
    );
    expect(report.basis).toBe("synthetic");
    expect(report.affected.p4).toEqual([{ reference: "P:X-R" }]);
    expect(report.operations.users).toEqual({ admin: 1 });
    expect(report.operations.requests).toEqual({ pending: 1 });
    const text = JSON.stringify(report) + renderConfigParityMarkdown(report);
    expect(text).not.toContain("someone@example.test");
    expect(renderConfigParityMarkdown(report)).toContain("KEIN Nachweis");
  });
});

/* ── Round trip against a real database ─────────────────────────────────────────────────── */

let db: Database;
let client: TestDatabase["client"];
let close: () => Promise<void>;
const up = { tenantId: "unique-places" };
const SHA = "d".repeat(64);
const t0 = new Date("2026-11-09T08:00:00Z");

const roundTripSnapshot = (overrides: Record<string, unknown> = {}) =>
  snap({
    "catalog:ALTUS:items": {
      "ALTUS-LCO": base("ALTUS-LCO", {
        bookingRule: "departure_day",
        displayName: "Late check-out",
        priceUnitLabel: "einmalig",
        sortOrder: 2,
      }),
      "ALTUS-HUND": base("ALTUS-HUND", {
        bookingRule: "per_night",
        maxOnePerReservation: "true",
        allowedUnitGroupIds: ["ALTUS-DOG", "bad id!"],
        sortOrder: null,
      }),
      "ALTUS-PKW": base("ALTUS-PKW", {
        bookingRule: "per_night",
        requiresVehicleRegistration: true,
        fulfillmentMode: "request",
        sortOrder: 2.5,
      }),
      "ALTUS-EXTRPERSON": base("ALTUS-EXTRPERSON", {
        actionType: "increase_occupancy",
        extraPersonPricePerNight: "35,50",
        requiresRemainingCapacity: false,
      }),
      "ALTUS-ODD": base("ALTUS-ODD", { fulfillmentMode: "manual", active: "false" }),
    },
    "extension-night:config:ALTUS": {
      extensionNightEnabled: true,
      minSellableStayNights: null,
      extensionDiscountPreArrivalOneNightGap: 12.5,
      extensionDiscountInHouseStandard: 100,
    },
    ...overrides,
  });

const importRun = (s: ExtrasSnapshotLike, now: Date, extra: { slackRoute?: string } = {}) =>
  importExtrasSnapshot(db, up, s, {
    mode: "apply",
    snapshotSha256: SHA,
    actorAdminId: null,
    now,
    ...extra,
  });

beforeAll(async () => {
  ({ db, client, close } = await createTestDatabase());
  await seedTenant(db, uniquePlacesSeed);
});

afterAll(async () => {
  await close();
});

describe("round trip: the stored STAY rows equal the planned values", () => {
  it("every imported configuration field and the extension settings", async () => {
    const s = roundTripSnapshot();
    const result = await importRun(s, t0, { slackRoute: "extras-requests" });
    expect(result.items.filter((i) => i.action === "error")).toEqual([]);

    const rows = await client.query<{
      extras_service_id: string;
      active: boolean;
      action_type: string;
      booking_rule: string;
      fulfillment: string;
      extra_person_price_cents: number | null;
      requires_remaining_capacity: boolean;
      requires_vehicle_registration: boolean;
      max_one_per_reservation: boolean;
      allowed_unit_group_ids: string[];
      sort_order: number;
      extras_texts: Record<string, string> | null;
      price_unit_label: Record<string, string> | null;
    }>(
      `SELECT * FROM offer_properties WHERE tenant_id = 'unique-places' AND legacy_key LIKE 'ALTUS:%'`,
    );
    const items = Object.values(
      (s.entries.find((e) => e.key === "catalog:ALTUS:items")?.value ?? {}) as Record<
        string,
        Record<string, unknown>
      >,
    );
    expect(rows.rows).toHaveLength(items.length);
    for (const item of items) {
      const row = rows.rows.find((r) => r.extras_service_id === item.serviceId);
      const { config } = configWithWarnings(item);
      expect(row).toMatchObject({
        active: config.active,
        action_type: config.actionType,
        booking_rule: config.bookingRule,
        fulfillment: config.fulfillment,
        extra_person_price_cents: config.extraPersonPriceCents,
        requires_remaining_capacity: config.requiresRemainingCapacity,
        requires_vehicle_registration: config.requiresVehicleRegistration,
        max_one_per_reservation: config.maxOnePerReservation,
        allowed_unit_group_ids: [...config.allowedUnitGroupIds],
        sort_order: config.sortOrder,
        extras_texts: extrasTextsOf(item),
      });
    }
    const settings = await client.query<Record<string, unknown>>(
      `SELECT * FROM property_service_settings WHERE tenant_id = 'unique-places' AND property_id = 'hov'`,
    );
    const stored = s.entries.find((e) => e.key === "extension-night:config:ALTUS")?.value as Record<
      string,
      unknown
    >;
    const planned = mapExtensionSettings(stored).values;
    expect(settings.rows[0]).toMatchObject({
      extension_night_enabled: false, // Extras: min null → no offer
      discount_pre_arrival_one_night_gap: planned.discountPreArrivalOneNightGap,
      discount_in_house_standard: 90,
      min_sellable_stay_nights: planned.minSellableStayNights,
      slack_route: "extras-requests",
    });
    // Every interpretation is in the report.
    const warnings = result.items.flatMap((i) => i.warnings ?? []);
    for (const code of [
      "p1_boolean_differs:active",
      "unknown_fulfillment_hidden_in_extras",
      "p2_extra_person_price_differs",
      "sort_order_rounded",
      "invalid_unit_group_ids_dropped",
      "extension_off_invalid_min_in_extras",
      "discount_rounded:extensionDiscountPreArrivalOneNightGap",
      "discount_clamped:extensionDiscountInHouseStandard",
    ])
      expect(warnings).toContain(code);
  });

  it("a repeated import of the same snapshot changes nothing", async () => {
    const again = await importRun(roundTripSnapshot(), new Date(t0.getTime() + 60_000), {
      slackRoute: "extras-requests",
    });
    const changing = again.items.filter(
      (i) =>
        ["catalog_item", "property_settings", "slack_route"].includes(i.entityType) &&
        i.action !== "unchanged",
    );
    expect(changing).toEqual([]);
  });

  it("a change in Extras updates; a STAY edit is kept and reported as conflict", async () => {
    // Extras changed the dog's order meanwhile.
    const changed = roundTripSnapshot();
    const items = changed.entries.find((e) => e.key === "catalog:ALTUS:items")?.value as Record<
      string,
      Record<string, unknown>
    >;
    items["ALTUS-HUND"] = { ...items["ALTUS-HUND"], sortOrder: 5 };
    // …and an admin edited the parking configuration in STAY.
    await client.query(
      `UPDATE offer_properties SET requires_vehicle_registration = false, updated_at = $1
         WHERE extras_service_id = 'ALTUS-PKW' AND tenant_id = 'unique-places'`,
      [new Date(t0.getTime() + 3_600_000)],
    );
    items["ALTUS-PKW"] = { ...items["ALTUS-PKW"], displayNameDe: "Parkplatz" };
    const result = await importRun(changed, new Date(t0.getTime() + 7_200_000));
    const byKey = (key: string) =>
      result.items.find((i) => i.entityType === "catalog_item" && i.sourceKey === key);
    expect(byKey("ALTUS:ALTUS-HUND")?.action).toBe("update");
    expect(byKey("ALTUS:ALTUS-PKW")).toMatchObject({
      action: "conflict",
      reason: "changed_in_stay_since_import",
    });
    const pkw = await client.query<{ requires_vehicle_registration: boolean }>(
      `SELECT requires_vehicle_registration FROM offer_properties WHERE extras_service_id = 'ALTUS-PKW'`,
    );
    expect(pkw.rows[0]?.requires_vehicle_registration).toBe(false); // STAY edit kept
  });

  it("a request decided in Extras after the first import is mirrored (never decided twice)", async () => {
    const request = (status: string, extra: Record<string, unknown> = {}) => ({
      "requests:items": {
        "req-sync": {
          requestId: "req-sync",
          reservationId: "SYNCRES-1",
          propertyId: "ALTUS",
          serviceId: "ALTUS-PKW",
          requestedQuantity: 1,
          requestedServiceDates: ["2026-12-01"],
          departureDate: "2026-12-03",
          status,
          createdAt: "2026-11-01T09:00:00Z",
          ...extra,
        },
      },
    });
    const first = await importRun(
      roundTripSnapshot(request("pending")),
      new Date(t0.getTime() + 8_000_000),
    );
    expect(first.items.find((i) => i.sourceKey === "request:req-sync")?.action).toBe("create");
    const second = await importRun(
      roundTripSnapshot(
        request("approved", {
          approvedAt: "2026-11-02T10:00:00Z",
          bookedServiceDates: ["2026-12-01"],
        }),
      ),
      new Date(t0.getTime() + 8_100_000),
    );
    expect(second.items.find((i) => i.sourceKey === "request:req-sync")).toMatchObject({
      action: "update",
      reason: "synced_from_extras",
    });
    const row = await client.query<{ status: string; booked_service_dates: string[] }>(
      `SELECT status, booked_service_dates FROM offer_requests WHERE legacy_id = 'req-sync'`,
    );
    expect(row.rows[0]?.status).toBe("confirmed");
    const third = await importRun(
      roundTripSnapshot(
        request("approved", {
          approvedAt: "2026-11-02T10:00:00Z",
          bookedServiceDates: ["2026-12-01"],
        }),
      ),
      new Date(t0.getTime() + 8_200_000),
    );
    expect(third.items.find((i) => i.sourceKey === "request:req-sync")?.action).toBe("unchanged");
  });

  it("an existing STAY Slack route is never replaced", async () => {
    await client.query(
      `UPDATE property_service_settings SET slack_route = 'hov-team' WHERE property_id = 'hov'`,
    );
    const result = await importRun(roundTripSnapshot(), new Date(t0.getTime() + 9_000_000), {
      slackRoute: "extras-requests",
    });
    expect(result.items.find((i) => i.entityType === "slack_route")).toMatchObject({
      action: "skip",
      reason: "route_set_in_stay",
    });
  });
});
