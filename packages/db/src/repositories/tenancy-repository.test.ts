import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database } from "../client";
import { seedTenant } from "../seed/seed-tenant";
import { uniquePlacesSeed } from "../seed/unique-places";
import { createTestDatabase } from "../testing/test-database";
import {
  type ExternalReference,
  getPropertyById,
  getPropertyBySlug,
  getTenantBySlug,
  getUnitsForProperty,
  resolveExternalMapping,
} from "./tenancy-repository";

let db: Database;
let close: () => Promise<void>;

const uniquePlaces = { tenantId: "unique-places" };
const otherTenant = { tenantId: "other-tenant" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await seedTenant(db, uniquePlacesSeed);
  // A second tenant with a colliding slug, unit slug and external id (own PMS account).
  await seedTenant(db, {
    tenant: { id: "other-tenant", slug: "other-tenant", name: "Other Tenant" },
    properties: [
      {
        id: "other-hov",
        slug: "hov",
        displayName: "Other HØV",
        spokenName: "Other",
        locationName: "Anderswo",
        timezone: "Europe/Zurich",
        externalIds: { apaleo: "ALTUS" },
        units: [
          {
            id: "other-ros",
            slug: "ros",
            displayName: "ROS",
            externalIds: { apaleo: "ALTUS-SWA" },
          },
          { id: "other-old", slug: "old", displayName: "OLD", isActive: false },
        ],
      },
    ],
  });
});

afterAll(async () => {
  await close();
});

describe("tenancy repository", () => {
  it("finds tenants by slug", async () => {
    expect(await getTenantBySlug(db, "unique-places")).toEqual({
      id: "unique-places",
      slug: "unique-places",
      name: "UNIQUE PLACES",
    });
    expect(await getTenantBySlug(db, "unknown")).toBeUndefined();
    expect(await getTenantBySlug(db, "'; DROP TABLE tenants; --")).toBeUndefined();
  });

  it("loads a property by id and slug within the tenant", async () => {
    const hov = await getPropertyById(db, uniquePlaces, "hov");
    expect(hov).toEqual({
      id: "hov",
      tenantId: "unique-places",
      slug: "hov",
      displayName: "HØV",
      spokenName: "Höv",
      locationName: "Altusried",
      timezone: "Europe/Berlin",
      isActive: true,
    });
    expect(await getPropertyBySlug(db, uniquePlaces, "hov")).toEqual(hov);
    // The same slug resolves to each tenant's own property.
    expect((await getPropertyBySlug(db, otherTenant, "hov"))?.id).toBe("other-hov");
  });

  it("never returns another tenant's property", async () => {
    expect(await getPropertyById(db, otherTenant, "hov")).toBeUndefined();
    expect(await getPropertyById(db, uniquePlaces, "other-hov")).toBeUndefined();
  });

  it("returns undefined for unknown or malformed ids", async () => {
    expect(await getPropertyById(db, uniquePlaces, "unknown")).toBeUndefined();
    expect(await getPropertyById(db, uniquePlaces, "HØV")).toBeUndefined();
    expect(await getPropertyBySlug(db, uniquePlaces, "")).toBeUndefined();
    expect(await getPropertyBySlug(db, { tenantId: "unknown" }, "hov")).toBeUndefined();
  });

  it("rejects an invalid tenant context", async () => {
    await expect(getPropertyById(db, { tenantId: "" }, "hov")).rejects.toThrow(TypeError);
  });

  it("lists the active units of a property, scoped to the tenant", async () => {
    const hovUnits = await getUnitsForProperty(db, uniquePlaces, "hov");
    expect(hovUnits.map((unit) => unit.id)).toEqual([
      "esl",
      "fux",
      "has",
      "igl",
      "kaz",
      "khu",
      "ros",
      "space",
    ]);
    expect(hovUnits.every((unit) => unit.tenantId === "unique-places")).toBe(true);
    expect(await getUnitsForProperty(db, uniquePlaces, "huesle")).toEqual([]);
    expect(await getUnitsForProperty(db, otherTenant, "hov")).toEqual([]);
    expect(await getUnitsForProperty(db, uniquePlaces, "other-hov")).toEqual([]);
  });

  it("includes inactive units only on request", async () => {
    const active = await getUnitsForProperty(db, otherTenant, "other-hov");
    const all = await getUnitsForProperty(db, otherTenant, "other-hov", { includeInactive: true });
    expect(active.map((unit) => unit.id)).toEqual(["other-ros"]);
    expect(all.map((unit) => unit.id)).toEqual(["other-old", "other-ros"]);
  });

  it("resolves Apaleo ids to internal ids per tenant", async () => {
    const unit = { provider: "apaleo", entityType: "unit", externalId: "ALTUS-SWA" } as const;
    expect(await resolveExternalMapping(db, uniquePlaces, unit)).toBe("ros");
    expect(await resolveExternalMapping(db, otherTenant, unit)).toBe("other-ros");
    expect(
      await resolveExternalMapping(db, uniquePlaces, {
        provider: "apaleo",
        entityType: "property",
        externalId: "ALTUS",
      }),
    ).toBe("hov");
  });

  it("does not resolve unknown, differently typed or case-mismatched external ids", async () => {
    const lookup = (reference: ExternalReference) =>
      resolveExternalMapping(db, uniquePlaces, reference);
    expect(
      await lookup({ provider: "apaleo", entityType: "unit", externalId: "TEST-ZHF" }),
    ).toBeUndefined();
    expect(
      await lookup({ provider: "apaleo", entityType: "unit", externalId: "ALTUS" }),
    ).toBeUndefined();
    expect(
      await lookup({ provider: "apaleo", entityType: "unit", externalId: "altus-swa" }),
    ).toBeUndefined();
    expect(
      await lookup({ provider: "apaleo", entityType: "unit", externalId: "" }),
    ).toBeUndefined();
  });

  it("rejects invalid provider and entity type values at runtime", async () => {
    await expect(
      resolveExternalMapping(db, uniquePlaces, {
        provider: "nuki" as ExternalReference["provider"],
        entityType: "unit",
        externalId: "X",
      }),
    ).rejects.toThrow("Unsupported external provider");
    await expect(
      resolveExternalMapping(db, uniquePlaces, {
        provider: "apaleo",
        entityType: "reservation" as ExternalReference["entityType"],
        externalId: "X",
      }),
    ).rejects.toThrow("Unsupported external entity type");
  });
});

describe("listPropertiesForTenant", () => {
  it("lists only the tenant's properties", async () => {
    const { listPropertiesForTenant } = await import("./tenancy-repository");
    const ids = (await listPropertiesForTenant(db, uniquePlaces)).map((property) => property.id);
    expect(ids.sort()).toEqual(["alpila", "hov", "huesle", "laeke"]);
    expect((await listPropertiesForTenant(db, otherTenant)).map((property) => property.id)).toEqual(
      ["other-hov"],
    );
  });
});
