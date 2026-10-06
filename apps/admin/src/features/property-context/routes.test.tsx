import { createLogger } from "@up/core";
import { type Database, listPropertiesForTenant, seedTenant, uniquePlacesSeed } from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTopic } from "../guide/guide-admin-service";

const state = vi.hoisted(() => ({
  db: undefined as Database | undefined,
  tenantId: "unique-places",
  remembered: null as string | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("../auth/server", () => ({
  requireAdmin: () =>
    Promise.resolve({ adminUserId: "a", tenantId: state.tenantId, email: "redaktion@example.com" }),
}));
vi.mock("../../server/database", () => ({ getDatabase: () => state.db }));
vi.mock("../guide/server", () => ({
  guideDeps: () => ({
    db: state.db,
    logger: createLogger({ sink: () => undefined }),
    now: () => new Date("2026-10-10T08:00:00Z"),
    isAllowedImageSrc: () => true,
    verifyNewImage: () => Promise.resolve(true),
  }),
  mediaStorageConfig: () => undefined,
}));
vi.mock("./server", async () => {
  const db = await import("@up/db");
  return {
    getTenantProperties: async () =>
      (await db.listPropertiesForTenant(state.db as Database, { tenantId: state.tenantId })).map(
        (property) => ({
          id: property.id,
          displayName: property.displayName,
          spokenName: property.spokenName,
          locationName: property.locationName,
        }),
      ),
    getRememberedPropertyId: () => Promise.resolve(state.remembered),
  };
});

const { default: AdminHome } = await import("../../app/(admin)/page");
const { default: PropertiesPage } = await import("../../app/(admin)/properties/page");
const { default: GuideAllPropertiesPage } = await import("../../app/(admin)/guide/page");
const { default: GuidePropertyLayout } =
  await import("../../app/(admin)/guide/[propertyId]/layout");
const { default: GuideTopicsPage } = await import("../../app/(admin)/guide/[propertyId]/page");

let test: TestDatabase;

beforeEach(async () => {
  test = await createTestDatabase();
  state.db = test.db;
  state.tenantId = "unique-places";
  state.remembered = null;
  await seedTenant(test.db, uniquePlacesSeed);
  await seedTenant(test.db, {
    tenant: { id: "other-tenant", slug: "other-tenant", name: "Other" },
    properties: [
      {
        id: "other-hov",
        slug: "hov",
        displayName: "Fremd",
        spokenName: "Fremd",
        locationName: "Anderswo",
        timezone: "Europe/Berlin",
      },
    ],
  });
});

afterEach(async () => {
  await test.close();
});

/** next/navigation's redirect()/notFound() throw errors carrying a digest. */
async function thrownDigest(run: () => unknown): Promise<string> {
  try {
    await run();
  } catch (error) {
    return String((error as { digest?: string }).digest);
  }
  return "no error";
}

const hrefs = (markup: string) => [...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

describe("admin routes with property context", () => {
  it("lists the tenant's properties from the database (not hardcoded) on Objekte", async () => {
    const markup = renderToStaticMarkup(await PropertiesPage());
    const own = await listPropertiesForTenant(test.db, { tenantId: "unique-places" });
    expect(own.length).toBeGreaterThan(0);
    expect(hrefs(markup)).toEqual(own.map((property) => `/guide/${property.id}`));
    expect(markup).not.toContain("Fremd");
  });

  it("Guide with Alle Objekte asks for a property instead of mixing content", async () => {
    const markup = renderToStaticMarkup(await GuideAllPropertiesPage());
    expect(markup).toContain("Wähle das Objekt");
    expect(hrefs(markup)).toContain("/guide/hov");
    expect(hrefs(markup)).not.toContain("/guide/other-hov");
    expect(markup).not.toContain("Neues Thema");
  });

  it("Guide with a selected property shows exactly that property's topics", async () => {
    const deps = (await import("../guide/server")).guideDeps();
    await createTopic(deps, { tenantId: "unique-places" }, "hov", {
      titleDe: "WLAN",
      titleEn: "",
      shortDescriptionDe: "Netz",
      shortDescriptionEn: "",
      icon: "wifi",
      scope: "property",
      unitId: "",
    });
    const hov = renderToStaticMarkup(
      await GuideTopicsPage({
        params: Promise.resolve({ propertyId: "hov" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(hov).toContain("WLAN");
    expect(hov).toMatch(/href="\/guide\/hov\/[0-9a-f-]{36}"/);
    expect(hov).toContain('href="/guide/hov/new"');
    const laeke = renderToStaticMarkup(
      await GuideTopicsPage({
        params: Promise.resolve({ propertyId: "laeke" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(laeke).not.toMatch(/href="\/guide\/(hov|laeke)\/[0-9a-f-]{36}"/);
    expect(laeke).toContain("Noch keine Guide-Themen");
  });

  it("answers unknown and other tenants' properties with 404 (deep links included)", async () => {
    const layout = (propertyId: string) => () =>
      GuidePropertyLayout({ children: null, params: Promise.resolve({ propertyId }) });
    expect(await thrownDigest(layout("other-hov"))).toMatch(/404/);
    expect(await thrownDigest(layout("does-not-exist"))).toMatch(/404/);
    expect(await thrownDigest(layout("hov"))).toBe("no error");

    state.tenantId = "other-tenant";
    expect(await thrownDigest(layout("hov"))).toMatch(/404/);
    expect(await thrownDigest(layout("other-hov"))).toBe("no error");
  });

  it("opens the start module in the remembered property context", async () => {
    expect(await thrownDigest(() => AdminHome())).toMatch(/;\/guide;/);
    state.remembered = "laeke";
    expect(await thrownDigest(() => AdminHome())).toMatch(/;\/guide\/laeke;/);
  });
});
