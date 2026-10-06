import { createLogger } from "@up/core";
import {
  type Database,
  getExplorePlace,
  listPublishedExplorePlaces,
  seedTenant,
  uniquePlacesSeed,
} from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  changePlaceStatus,
  createPlace,
  deletePlace,
  type ExploreAdminDeps,
  loadExploreOverview,
  loadPlace,
  movePlace,
  type PlaceFormInput,
  updatePlace,
} from "./explore-admin-service";

const up = { tenantId: "unique-places" };
const other = { tenantId: "other-tenant" };
const MEDIA = "https://abc.supabase.co/storage/v1/object/public/guide-media/";
const UUID = "123e4567-e89b-42d3-a456-426614174000";
let test: TestDatabase;
let db: Database;
let deps: ExploreAdminDeps;
let verified: string[];

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  await seedTenant(db, uniquePlacesSeed);
  await seedTenant(db, {
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
  verified = [];
  deps = {
    db,
    logger: createLogger({ sink: () => undefined }),
    now: () => new Date("2026-10-10T08:00:00Z"),
    isAllowedImageSrc: (src, tenantId) => src.startsWith(`${MEDIA}${tenantId}/explore/`),
    verifyNewImage: (src) => {
      verified.push(src);
      return Promise.resolve(!src.includes("broken"));
    },
  };
});

afterEach(async () => {
  await test.close();
});

const newPlace = (overrides: Partial<Parameters<typeof createPlace>[2]> = {}) => ({
  titleDe: "Seecafé",
  titleEn: "Lake café",
  teaserDe: "Kaffee am Wasser",
  teaserEn: "",
  category: "food-drink",
  propertyIds: ["laeke"],
  ...overrides,
});

function form(overrides: Partial<PlaceFormInput> = {}): PlaceFormInput {
  return {
    titleDe: "Seecafé",
    titleEn: "Lake café",
    slugDe: "seecafe",
    slugEn: "lake-cafe",
    category: "food-drink",
    teaserDe: "Kaffee am Wasser",
    teaserEn: "Coffee by the water",
    descriptionDe: "Erster Absatz.\n\nZweiter Absatz.",
    descriptionEn: "",
    tipDe: "",
    tipEn: "",
    openingHoursDe: "",
    openingHoursEn: "",
    heroImage: "",
    address: "Seepromenade 1\n88131 Lindau",
    locality: "Lindau",
    mapsUrl: "",
    websiteUrl: "https://seecafe.example.org",
    phone: "+49 8382 12345",
    reservationUrl: "",
    featured: false,
    propertyIds: ["laeke"],
    ...overrides,
  };
}

async function created(overrides: Partial<Parameters<typeof createPlace>[2]> = {}) {
  const result = await createPlace(deps, up, newPlace(overrides));
  if (!result.ok) throw new Error(result.error);
  return result.id;
}

describe("EXPLORE administration", () => {
  it("creates a draft with a unique slug from the title, after all other places", async () => {
    const first = await created();
    const second = await created();
    const a = await getExplorePlace(db, up, first);
    const b = await getExplorePlace(db, up, second);
    expect(a).toMatchObject({
      status: "draft",
      slug: { de: "seecafe", en: "lake-cafe" },
      propertyIds: ["laeke"],
    });
    expect(b?.slug).toEqual({ de: "seecafe-2", en: "lake-cafe-2" });
    expect(b?.sortOrder).toBeGreaterThan(a?.sortOrder ?? 0);
    expect(await createPlace(deps, up, newPlace({ titleDe: " " }))).toMatchObject({ ok: false });
    expect(await createPlace(deps, up, newPlace({ teaserDe: "" }))).toMatchObject({ ok: false });
    expect(await createPlace(deps, up, newPlace({ category: "nightlife" }))).toMatchObject({
      ok: false,
    });
  });

  it("refuses manipulated property assignments (other tenant, unknown, malformed)", async () => {
    for (const propertyIds of [
      ["other-hov"],
      ["laeke", "other-hov"],
      ["does-not-exist"],
      ["../x"],
    ]) {
      expect(await createPlace(deps, up, newPlace({ propertyIds }))).toMatchObject({ ok: false });
    }
    const id = await created();
    for (const propertyIds of [["other-hov"], ["laeke", "does-not-exist"]]) {
      expect(await updatePlace(deps, up, id, form({ propertyIds }))).toMatchObject({ ok: false });
    }
    expect((await getExplorePlace(db, up, id))?.propertyIds).toEqual(["laeke"]);
  });

  it("saves all fields with multiple properties; published places are live at once", async () => {
    const id = await created();
    expect(
      await updatePlace(deps, up, id, form({ propertyIds: ["laeke", "huesle"], featured: true })),
    ).toEqual({
      ok: true,
    });
    const place = await getExplorePlace(db, up, id);
    expect(place).toMatchObject({
      teaser: { de: "Kaffee am Wasser", en: "Coffee by the water" },
      description: { de: "Erster Absatz.\n\nZweiter Absatz." },
      locality: "Lindau",
      websiteUrl: "https://seecafe.example.org",
      phone: "+49 8382 12345",
      featured: true,
      propertyIds: ["huesle", "laeke"],
      translationState: { en: "missing" },
    });
    expect(place?.reservationUrl).toBeUndefined();
    expect(place?.tip).toBeUndefined();

    expect(await listPublishedExplorePlaces(db, up, "huesle")).toEqual([]);
    expect(await changePlaceStatus(deps, up, id, "published")).toEqual({ ok: true });
    expect((await listPublishedExplorePlaces(db, up, "huesle")).map((p) => p.id)).toEqual([id]);
    await updatePlace(deps, up, id, form({ titleDe: "Seecafé am Hafen", propertyIds: ["huesle"] }));
    expect((await listPublishedExplorePlaces(db, up, "huesle"))[0]?.title.de).toBe(
      "Seecafé am Hafen",
    );
    expect(await listPublishedExplorePlaces(db, up, "laeke")).toEqual([]);
  });

  it("validates links, phone, URL names and images", async () => {
    const id = await created();
    for (const patch of [
      { websiteUrl: "javascript:alert(1)" },
      { mapsUrl: "ftp://example.org" },
      { reservationUrl: "mailto:reservierung@example.org" },
      { phone: "ruf an" },
      { slugDe: "Mit Leerzeichen" },
      { titleDe: "" },
      { heroImage: "{kaputt" },
      {
        heroImage: JSON.stringify({
          src: `${MEDIA}other-tenant/explore/${UUID}.png`,
          width: 10,
          height: 10,
          alt: { de: "x" },
        }),
      },
      {
        heroImage: JSON.stringify({
          src: "https://evil.example/x.png",
          width: 10,
          height: 10,
          alt: { de: "x" },
        }),
      },
    ]) {
      expect((await updatePlace(deps, up, id, form(patch))).ok, JSON.stringify(patch)).toBe(false);
    }
    await created({ titleDe: "Hafenbar", titleEn: "" });
    expect(await updatePlace(deps, up, id, form({ slugDe: "hafenbar" }))).toMatchObject({
      ok: false,
    });

    const image = (name: string) =>
      JSON.stringify({
        src: `${MEDIA}unique-places/explore/${name}`,
        width: 1200,
        height: 800,
        alt: { de: "Terrasse", en: "Terrace" },
      });
    expect(await updatePlace(deps, up, id, form({ heroImage: image(`${UUID}.webp`) }))).toEqual({
      ok: true,
    });
    expect(verified).toEqual([`${MEDIA}unique-places/explore/${UUID}.webp`]);
    // Unchanged image: not verified again; a broken new one is refused.
    expect(await updatePlace(deps, up, id, form({ heroImage: image(`${UUID}.webp`) }))).toEqual({
      ok: true,
    });
    expect(verified).toHaveLength(1);
    expect(
      await updatePlace(deps, up, id, form({ heroImage: image("broken.webp") })),
    ).toMatchObject({ ok: false });
  });

  it("knows whether English is complete", async () => {
    const id = await created();
    await updatePlace(
      deps,
      up,
      id,
      form({ descriptionDe: "", titleEn: "Lake café", teaserEn: "Coffee" }),
    );
    expect((await loadPlace(deps, up, id))?.englishComplete).toBe(true);
    await updatePlace(deps, up, id, form({ tipDe: "Probier den Kuchen." }));
    expect((await loadPlace(deps, up, id))?.englishComplete).toBe(false);
  });

  it("lists all places with assignments, or one property's places", async () => {
    const lake = await created({ propertyIds: ["laeke", "huesle"] });
    const unassigned = await created({ titleDe: "Hofladen", titleEn: "", propertyIds: [] });
    const all = await loadExploreOverview(deps, up, null);
    expect(all?.properties.map((property) => property.id)).toEqual(
      expect.arrayContaining(["hov", "huesle", "laeke", "alpila"]),
    );
    expect(all?.places.map((place) => place.id)).toEqual([lake, unassigned]);
    expect(all?.places[0]?.propertyIds).toEqual(["huesle", "laeke"]);
    expect((await loadExploreOverview(deps, up, "huesle"))?.places.map((p) => p.id)).toEqual([
      lake,
    ]);
    expect(await loadExploreOverview(deps, up, "other-hov")).toBeUndefined();
    expect(await loadExploreOverview(deps, up, "unknown")).toBeUndefined();
    expect((await loadExploreOverview(deps, other, null))?.places).toEqual([]);
  });

  it("never lets another tenant read, change, publish, delete or move a place", async () => {
    const id = await created();
    expect(await loadPlace(deps, other, id)).toBeUndefined();
    expect(await updatePlace(deps, other, id, form({ propertyIds: [] }))).toMatchObject({
      ok: false,
    });
    expect(await changePlaceStatus(deps, other, id, "published")).toMatchObject({ ok: false });
    expect(await deletePlace(deps, other, id)).toMatchObject({ ok: false });
    expect(await movePlace(deps, other, id, "up", null)).toMatchObject({ ok: false });
    expect((await getExplorePlace(db, up, id))?.status).toBe("draft");
    expect(await loadPlace(deps, up, "not-a-uuid")).toBeUndefined();
  });

  it("archives and deletes only according to the publication history", async () => {
    const draft = await created();
    expect(await deletePlace(deps, up, draft)).toEqual({ ok: true });
    const live = await created();
    await changePlaceStatus(deps, up, live, "published");
    await changePlaceStatus(deps, up, live, "archived");
    expect(await deletePlace(deps, up, live)).toMatchObject({ ok: false });
    expect(await listPublishedExplorePlaces(db, up, "laeke")).toEqual([]);
    expect(await changePlaceStatus(deps, up, live, "gelöscht")).toMatchObject({ ok: false });
  });

  it("reorders within the current view (all places or one property)", async () => {
    const a = await created({ titleDe: "A", titleEn: "", propertyIds: ["laeke"] });
    const b = await created({ titleDe: "B", titleEn: "", propertyIds: ["hov"] });
    const c = await created({ titleDe: "C", titleEn: "", propertyIds: ["laeke"] });
    const order = async (propertyId: string | null) =>
      (await loadExploreOverview(deps, up, propertyId))?.places.map((place) => place.title.de);
    expect(await order("laeke")).toEqual(["A", "C"]);
    await movePlace(deps, up, c, "up", "laeke");
    expect(await order("laeke")).toEqual(["C", "A"]);
    expect(await order(null)).toEqual(["C", "B", "A"]);
    await movePlace(deps, up, b, "down", null);
    expect(await order(null)).toEqual(["C", "A", "B"]);
    expect(await movePlace(deps, up, a, "up", "hov")).toMatchObject({ ok: false });
  });
});
