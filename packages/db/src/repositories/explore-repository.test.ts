import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database } from "../client";
import { explorePlaceProperties, explorePlaces } from "../schema";
import { exploreFixtures, seedExploreFixtures } from "../seed/explore-fixtures";
import { seedTenant } from "../seed/seed-tenant";
import { uniquePlacesSeed } from "../seed/unique-places";
import { createTestDatabase, expectConstraintViolation } from "../testing/test-database";
import {
  createExplorePlace,
  deleteUnpublishedExplorePlace,
  ExploreAssignmentError,
  type ExplorePlaceFields,
  getExplorePlace,
  listExplorePlaces,
  listPublishedExplorePlaces,
  setExplorePlaceOrder,
  setExplorePlaceStatus,
  updateExplorePlace,
} from "./explore-repository";

let db: Database;
let close: () => Promise<void>;
const up = { tenantId: "unique-places" };
const other = { tenantId: "other-tenant" };
const now = new Date("2026-10-10T10:00:00Z");

const fields = (name: string, overrides: Partial<ExplorePlaceFields> = {}): ExplorePlaceFields => ({
  category: "food-drink",
  slug: { de: name },
  title: { de: name },
  teaser: { de: `Teaser ${name}` },
  featured: false,
  translationState: {},
  propertyIds: ["laeke"],
  ...overrides,
});

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
      },
    ],
  });
});

afterAll(async () => {
  await close();
});

describe("explore_places", () => {
  it("shows a guest only published places assigned to their property", async () => {
    const lake = await createExplorePlace(db, up, {
      ...fields("seebad", { category: "wellness" }),
      sortOrder: 10,
    });
    const both = await createExplorePlace(db, up, {
      ...fields("hafen", { propertyIds: ["laeke", "huesle"] }),
      sortOrder: 20,
    });
    const draft = await createExplorePlace(db, up, { ...fields("entwurf"), sortOrder: 30 });
    const unassigned = await createExplorePlace(db, up, {
      ...fields("ohne-objekt", { propertyIds: [] }),
      sortOrder: 40,
    });
    for (const place of [lake, both, unassigned]) {
      await setExplorePlaceStatus(db, up, place.id, "published", now);
    }

    const laeke = await listPublishedExplorePlaces(db, up, "laeke");
    expect(laeke.map((place) => place.slug.de)).toEqual(["seebad", "hafen"]);
    expect(laeke[1]?.propertyIds).toEqual(["huesle", "laeke"]);
    expect((await listPublishedExplorePlaces(db, up, "huesle")).map((p) => p.slug.de)).toEqual([
      "hafen",
    ]);
    expect(await listPublishedExplorePlaces(db, up, "hov")).toEqual([]);
    // Draft and unassigned never reach a guest; other tenants see nothing.
    expect(laeke.some((place) => place.id === draft.id || place.id === unassigned.id)).toBe(false);
    expect(await listPublishedExplorePlaces(db, other, "laeke")).toEqual([]);
    expect(await listPublishedExplorePlaces(db, up, "../x")).toEqual([]);

    await setExplorePlaceStatus(db, up, lake.id, "archived", now);
    expect((await listPublishedExplorePlaces(db, up, "laeke")).map((p) => p.slug.de)).toEqual([
      "hafen",
    ]);
  });

  it("orders highlights first, then by sort order; reordering is tenant-scoped", async () => {
    const a = await createExplorePlace(db, up, {
      ...fields("order-a", { propertyIds: ["alpila"] }),
      sortOrder: 10,
    });
    const b = await createExplorePlace(db, up, {
      ...fields("order-b", { propertyIds: ["alpila"] }),
      sortOrder: 20,
    });
    const star = await createExplorePlace(db, up, {
      ...fields("order-star", { propertyIds: ["alpila"], featured: true }),
      sortOrder: 90,
    });
    for (const place of [a, b, star])
      await setExplorePlaceStatus(db, up, place.id, "published", now);
    const slugs = async () =>
      (await listPublishedExplorePlaces(db, up, "alpila")).map((place) => place.slug.de);
    expect(await slugs()).toEqual(["order-star", "order-a", "order-b"]);
    await setExplorePlaceOrder(db, up, [b.id, a.id, star.id]);
    expect(await slugs()).toEqual(["order-star", "order-b", "order-a"]);
    // Another tenant cannot reorder these places.
    await setExplorePlaceOrder(db, other, [a.id, b.id]);
    expect(await slugs()).toEqual(["order-star", "order-b", "order-a"]);
  });

  it("lists all places of the tenant or one property for the admin", async () => {
    const all = await listExplorePlaces(db, up);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((place) => place.tenantId === "unique-places")).toBe(true);
    expect(all.some((place) => place.status === "archived")).toBe(false);
    expect((await listExplorePlaces(db, up, { includeArchived: true })).length).toBeGreaterThan(
      all.length,
    );
    const huesle = await listExplorePlaces(db, up, { propertyId: "huesle" });
    expect(huesle.map((place) => place.slug.de)).toEqual(["hafen"]);
    expect(await listExplorePlaces(db, other)).toEqual([]);
  });

  it("never assigns a place to another tenant's or an unknown property", async () => {
    await expect(
      createExplorePlace(db, up, {
        ...fields("fremd", { propertyIds: ["other-hov"] }),
        sortOrder: 1,
      }),
    ).rejects.toThrow(ExploreAssignmentError);
    await expect(
      createExplorePlace(db, up, {
        ...fields("fremd2", { propertyIds: ["does-not-exist"] }),
        sortOrder: 1,
      }),
    ).rejects.toThrow(ExploreAssignmentError);
    const own = await createExplorePlace(db, up, { ...fields("eigen"), sortOrder: 1 });
    await expect(
      updateExplorePlace(db, up, own.id, fields("eigen", { propertyIds: ["laeke", "other-hov"] })),
    ).rejects.toThrow(ExploreAssignmentError);
    // The failed update changed nothing (transaction).
    expect((await getExplorePlace(db, up, own.id))?.propertyIds).toEqual(["laeke"]);
    // Even bypassing the repository, the database refuses the cross-tenant row.
    await expectConstraintViolation(
      db
        .insert(explorePlaceProperties)
        .values({ tenantId: "unique-places", placeId: own.id, propertyId: "other-hov" }),
      "explore_place_properties_property_fkey",
    );
    await expectConstraintViolation(
      db
        .insert(explorePlaceProperties)
        .values({ tenantId: "other-tenant", placeId: own.id, propertyId: "other-hov" }),
      "explore_place_properties_place_fkey",
    );
  });

  it("replaces assignments on save; other tenants can neither read nor change a place", async () => {
    const place = await createExplorePlace(db, up, { ...fields("wechsel"), sortOrder: 1 });
    expect(
      await updateExplorePlace(
        db,
        up,
        place.id,
        fields("wechsel", { propertyIds: ["hov", "alpila"] }),
      ),
    ).toBe(true);
    expect((await getExplorePlace(db, up, place.id))?.propertyIds).toEqual(["alpila", "hov"]);
    expect(await getExplorePlace(db, other, place.id)).toBeUndefined();
    expect(
      await updateExplorePlace(db, other, place.id, fields("gekapert", { propertyIds: [] })),
    ).toBe(false);
    expect(await setExplorePlaceStatus(db, other, place.id, "published", now)).toBe(false);
    expect(await deleteUnpublishedExplorePlace(db, other, place.id)).toBe(false);
    expect((await getExplorePlace(db, up, place.id))?.title.de).toBe("wechsel");
    expect(await getExplorePlace(db, up, "not-a-uuid")).toBeUndefined();
  });

  it("deletes only never-published places; published ones can only be archived", async () => {
    const draft = await createExplorePlace(db, up, { ...fields("loeschbar"), sortOrder: 1 });
    expect(await deleteUnpublishedExplorePlace(db, up, draft.id)).toBe(true);
    const live = await createExplorePlace(db, up, { ...fields("bleibt"), sortOrder: 1 });
    await setExplorePlaceStatus(db, up, live.id, "published", now);
    await setExplorePlaceStatus(db, up, live.id, "draft", now);
    expect(await deleteUnpublishedExplorePlace(db, up, live.id)).toBe(false);
    expect((await getExplorePlace(db, up, live.id))?.firstPublishedAt).toEqual(now);
  });

  it("enforces category, links, phone and texts in the database", async () => {
    const base = {
      tenantId: "unique-places",
      category: "food-drink" as const,
      slug: { de: "x" },
      title: { de: "x" },
      teaser: { de: "x" },
    };
    await expectConstraintViolation(
      db.insert(explorePlaces).values({ ...base, category: "nightlife" as never }),
      "explore_places_category_valid",
    );
    await expectConstraintViolation(
      db.insert(explorePlaces).values({ ...base, websiteUrl: "javascript:alert(1)" }),
      "explore_places_website_url_valid",
    );
    await expectConstraintViolation(
      db.insert(explorePlaces).values({ ...base, reservationUrl: "mailto:x@example.org" }),
      "explore_places_reservation_url_valid",
    );
    await expectConstraintViolation(
      db.insert(explorePlaces).values({ ...base, phone: "call me" }),
      "explore_places_phone_valid",
    );
    await expectConstraintViolation(
      db.insert(explorePlaces).values({ ...base, title: { en: "only en" } }),
      "explore_places_texts_present",
    );
  });
});

describe("explore fixtures (local only)", () => {
  // Boots a second in-process database (with all migrations) inside the test.
  it("seeds the sample places idempotently, published except the draft", async () => {
    const fixtures = await createTestDatabase();
    try {
      await seedTenant(fixtures.db, uniquePlacesSeed);
      expect((await seedExploreFixtures(fixtures.db, up, now)).written).toBe(
        exploreFixtures.length,
      );
      expect((await seedExploreFixtures(fixtures.db, up, now)).written).toBe(0);
      const hov = await listPublishedExplorePlaces(fixtures.db, up, "hov");
      expect(hov[0]?.featured).toBe(true);
      expect(hov.map((place) => place.slug.de)).not.toContain("beispiel-radtour");
      expect(hov.map((place) => place.slug.de)).not.toContain("beispiel-hofladen");
      expect(
        (await listPublishedExplorePlaces(fixtures.db, up, "laeke")).map((p) => p.slug.de),
      ).toEqual(["beispiel-cafe", "beispiel-seebad"]);
    } finally {
      await fixtures.close();
    }
  }, 60_000);
});
