import { createLogger, SORT_ORDER_LAST } from "@up/core";
import {
  type Database,
  getCatalogOffer,
  listAdminAuditEvents,
  seedTenant,
  uniquePlacesSeed,
} from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type AdminContext } from "../auth/admin-auth-service";
import { fixtureServiceSource } from "./apaleo-source";
import {
  type CatalogDeps,
  changeOfferStatus,
  createOffer,
  loadApaleoOptions,
  loadCatalog,
  loadOffer,
  type OfferForm,
  parsePropertyConfigForm,
  type PropertyConfigForm,
  removeConfig,
  saveConfig,
  updateOffer,
} from "./catalog-service";

let test: TestDatabase;
let db: Database;
const deps = (overrides: Partial<CatalogDeps> = {}): CatalogDeps => ({
  db,
  logger: createLogger({ sink: () => undefined }),
  now: () => new Date("2026-11-08T10:00:00Z"),
  apaleo: fixtureServiceSource,
  apaleoPropertyIdOf: (_tenant, propertyId) =>
    Promise.resolve(
      propertyId === "test-run" ? "TEST" : propertyId === "hov" ? "ALTUS" : undefined,
    ),
  isAllowedImageSrc: (src) => src.startsWith("https://cdn.example.test/"),
  ...overrides,
});

const admin = (role: AdminContext["role"], propertyIds: string[] = []): AdminContext => ({
  adminUserId: realAdminId,
  tenantId: "unique-places",
  email: "a@example.test",
  role,
  propertyScope: propertyIds.length ? "selected" : "all",
  propertyIds,
});

const offerForm = (overrides: Partial<OfferForm> = {}): OfferForm => ({
  titleDe: "Später Check-out",
  titleEn: "Late check-out",
  teaserDe: "Bis 14 Uhr",
  teaserEn: "",
  bodyDe: "",
  bodyEn: "",
  detailsDe: "",
  detailsEn: "",
  category: "arrival-departure",
  fulfillment: "instant",
  cancellation: "free-until",
  cancellationHours: "24",
  heroImage: "",
  ...overrides,
});

const configForm = (overrides: Partial<PropertyConfigForm> = {}): PropertyConfigForm => ({
  extrasServiceId: "TEST-LCO",
  active: true,
  sortOrder: "1",
  actionType: "service",
  bookingRule: "departure_day",
  fulfillment: "instant",
  extraPersonPrice: "",
  priceUnitLabelDe: "",
  priceUnitLabelEn: "",
  requiresRemainingCapacity: false,
  requiresVehicleRegistration: false,
  maxOnePerReservation: false,
  allowedUnitGroupIds: [],
  titleOverrideDe: "",
  titleOverrideEn: "",
  teaserOverrideDe: "",
  teaserOverrideEn: "",
  ...overrides,
});

let offerId: string;
let realAdminId: string;

beforeAll(async () => {
  test = await createTestDatabase();
  db = test.db;
  await seedTenant(db, uniquePlacesSeed);
  await test.client.query(
    `INSERT INTO properties (id, tenant_id, slug, display_name, spoken_name, location_name, timezone)
     VALUES ('test-run', 'unique-places', 'test-run', 'Test run', 'Test run', 'Testumgebung', 'Europe/Berlin')`,
  );
  const row = await test.client.query<{ id: string }>(
    `INSERT INTO admin_users (tenant_id, email, password_hash, role) VALUES ('unique-places', 'o@example.test', 'scrypt$x', 'owner') RETURNING id`,
  );
  realAdminId = row.rows[0]?.id ?? "";
});

afterAll(async () => {
  await test.close();
});

const owner = () => ({ ...admin("owner"), adminUserId: realAdminId });

describe("central offers", () => {
  it("creates a draft with DE/EN texts; validates required German texts and cancellation", async () => {
    expect(await createOffer(deps(), owner(), offerForm({ titleDe: "" }))).toEqual({
      ok: false,
      error: "Bitte einen deutschen Titel angeben.",
    });
    expect((await createOffer(deps(), owner(), offerForm({ cancellationHours: "999" }))).ok).toBe(
      false,
    );
    const created = await createOffer(deps(), owner(), offerForm());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    offerId = created.id;
    const offer = await getCatalogOffer(db, { tenantId: "unique-places" }, offerId);
    expect(offer).toMatchObject({
      status: "draft",
      title: { de: "Später Check-out", en: "Late check-out" },
      teaser: { de: "Bis 14 Uhr" },
      cancellation: { type: "free-until", hoursBefore: 24 },
    });
  });

  it("accepts only images from the tenant's storage", async () => {
    const image = (src: string) =>
      JSON.stringify({ src, width: 800, height: 600, alt: { de: "Bild", en: "" } });
    expect(
      (
        await updateOffer(
          deps(),
          owner(),
          offerId,
          offerForm({ heroImage: image("https://evil.example/x.jpg") }),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await updateOffer(
          deps(),
          owner(),
          offerId,
          offerForm({ heroImage: image("https://cdn.example.test/u/offers/a.jpg") }),
        )
      ).ok,
    ).toBe(true);
  });

  it("offer texts and status are tenant-wide: managers limited to a property and viewers cannot change them", async () => {
    expect(
      await updateOffer(deps(), admin("manager", ["hov"]), offerId, offerForm()),
    ).toMatchObject({ ok: false });
    expect(await updateOffer(deps(), admin("viewer"), offerId, offerForm())).toMatchObject({
      ok: false,
    });
    expect(await changeOfferStatus(deps(), admin("viewer"), offerId, "published")).toMatchObject({
      ok: false,
    });
    expect((await createOffer(deps(), admin("viewer"), offerForm())).ok).toBe(false);
    expect((await changeOfferStatus(deps(), owner(), offerId, "published")).ok).toBe(true);
  });
});

describe("property configuration", () => {
  it("saves every Extras field; additional guests without price are saved but flagged, never free", async () => {
    expect(await saveConfig(deps(), owner(), offerId, "test-run", configForm())).toEqual({
      ok: true,
      created: true,
      issues: [],
    });
    const extra = await createOffer(deps(), owner(), offerForm({ titleDe: "Zusatzperson" }));
    if (!extra.ok) throw new Error("expected offer");
    const result = await saveConfig(
      deps(),
      owner(),
      extra.id,
      "test-run",
      configForm({
        extrasServiceId: "TEST-EXTRPERSON",
        actionType: "increase_occupancy",
        fulfillment: "request",
        bookingRule: "per_night",
        allowedUnitGroupIds: ["TEST-APT", "TEST-LOFT"],
      }),
    );
    expect(result).toEqual({ ok: true, created: true, issues: ["missing_extra_person_price"] });
    const stored = (await getCatalogOffer(db, { tenantId: "unique-places" }, extra.id))
      ?.properties[0];
    expect(stored).toMatchObject({
      actionType: "increase_occupancy",
      fulfillment: "instant",
      requiresRemainingCapacity: true,
      extraPersonPriceCents: null,
      allowedUnitGroupIds: ["TEST-APT", "TEST-LOFT"],
    });
    expect(
      await saveConfig(
        deps(),
        owner(),
        extra.id,
        "test-run",
        configForm({
          extrasServiceId: "TEST-EXTRPERSON",
          actionType: "increase_occupancy",
          extraPersonPrice: "35,50",
        }),
      ),
    ).toMatchObject({
      ok: true,
      issues: [],
    });
    expect(
      (await getCatalogOffer(db, { tenantId: "unique-places" }, extra.id))?.properties[0]
        ?.extraPersonPriceCents,
    ).toBe(3550);
    expect(
      (
        await saveConfig(
          deps(),
          owner(),
          extra.id,
          "test-run",
          configForm({ actionType: "increase_occupancy", extraPersonPrice: "gratis" }),
        )
      ).ok,
    ).toBe(false);
  });

  it("lets a manager edit only their property's configuration; viewers only read", async () => {
    const manager = admin("manager", ["test-run"]);
    expect(
      (await saveConfig(deps(), manager, offerId, "test-run", configForm({ sortOrder: "4" }))).ok,
    ).toBe(true);
    expect(
      await saveConfig(
        deps(),
        manager,
        offerId,
        "hov",
        configForm({ extrasServiceId: "ALTUS-LCO" }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      await saveConfig(deps(), admin("viewer"), offerId, "test-run", configForm()),
    ).toMatchObject({ ok: false });
    expect(await removeConfig(deps(), admin("viewer"), offerId, "test-run")).toMatchObject({
      ok: false,
    });
    const viewerCatalog = await loadCatalog(deps(), admin("viewer", ["test-run"]));
    expect(viewerCatalog.ok && viewerCatalog.canEditOffers).toBe(false);
  });

  it("shows a property-limited admin only their properties' configurations", async () => {
    await saveConfig(deps(), owner(), offerId, "hov", configForm({ extrasServiceId: "ALTUS-LCO" }));
    const limited = await loadOffer(deps(), admin("manager", ["test-run"]), offerId);
    expect(limited.ok && limited.offer.properties.map((p) => p.propertyId)).toEqual(["test-run"]);
    expect(limited.ok && limited.editableProperties).toEqual(["test-run"]);
    const catalog = await loadCatalog(deps(), admin("manager", ["hov"]));
    expect(
      catalog.ok && catalog.offers.flatMap((o) => o.properties.map((p) => p.propertyId)),
    ).toEqual(["hov"]);
  });

  it("reads Apaleo services read-only and falls back to manual entry", async () => {
    const options = await loadApaleoOptions(deps(), owner(), "test-run");
    expect(options).toMatchObject({ available: true, source: "fixture", apaleoPropertyId: "TEST" });
    expect(await loadApaleoOptions(deps({ apaleo: undefined }), owner(), "test-run")).toEqual({
      available: false,
      reason: "not-configured",
      apaleoPropertyId: "TEST",
    });
    expect(await loadApaleoOptions(deps(), owner(), "laeke")).toEqual({
      available: false,
      reason: "not-mapped",
    });
    const failing = {
      ...fixtureServiceSource,
      listServices: () => Promise.reject(new Error("boom")),
    };
    expect(await loadApaleoOptions(deps({ apaleo: failing }), owner(), "test-run")).toMatchObject({
      available: false,
      reason: "error",
    });
  });

  it("audits every change", async () => {
    const actions = (await listAdminAuditEvents(db, { tenantId: "unique-places" })).map(
      (e) => e.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        "catalog.offer_created",
        "catalog.offer_updated",
        "catalog.offer_status_changed",
        "catalog.property_config_created",
        "catalog.property_config_updated",
      ]),
    );
  });
});

describe("sort order (configuration parity)", () => {
  const parse = (sortOrder: string) => parsePropertyConfigForm(configForm({ sortOrder }));
  it("accepts decimals exactly, with comma or point", () => {
    for (const [text, value] of [
      ["1,5", 1.5],
      ["1.5", 1.5],
      ["10", 10],
      ["-2,25", -2.25],
      ["0", 0],
    ] as const) {
      const result = parse(text);
      expect(result.ok && result.config.sortOrder, text).toBe(value);
    }
  });
  it("empty means without order (after every numbered service, as in Extras)", () => {
    const result = parse("");
    expect(result.ok && result.config.sortOrder).toBe(SORT_ORDER_LAST);
  });
  it("refuses text and out-of-range values", () => {
    for (const text of ["abc", "1,2,3", "1e3", "1000000"]) expect(parse(text).ok, text).toBe(false);
  });
});
