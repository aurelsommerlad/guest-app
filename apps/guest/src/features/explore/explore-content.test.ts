import { categoriesOf, createLogger, EXPLORE_CATEGORIES } from "@up/core";
import {
  createExplorePlace,
  type Database,
  type ExplorePlaceFields,
  seedTenant,
  setExplorePlaceStatus,
  uniquePlacesSeed,
  updateExplorePlace,
} from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findPropertyById } from "../../config/properties";
import { type GuestContext } from "../guest-context/guest-context";
import { loadExplorePlaces } from "./explore-content";
import { createExploreResolver } from "./resolve-explore";

const logger = createLogger({ sink: () => undefined });
const up = { tenantId: "unique-places" };
const now = new Date("2026-10-10T12:00:00+02:00");

function guestOf(propertyId: string, tenantId = "unique-places"): GuestContext {
  const property = findPropertyById(propertyId);
  if (!property) throw new Error(`${propertyId} missing`);
  return {
    mode: "guest",
    tenantId,
    propertyId,
    reservationProvider: "apaleo",
    externalReservationId: "IHESZZFV-1",
    property,
    now,
    reservation: { status: "unavailable" },
  };
}

const fields = (slug: string, overrides: Partial<ExplorePlaceFields> = {}): ExplorePlaceFields => ({
  category: "food-drink",
  slug: { de: slug, en: `${slug}-en` },
  title: { de: `Titel ${slug}`, en: `Title ${slug}` },
  teaser: { de: `Teaser ${slug}` },
  featured: false,
  translationState: {},
  propertyIds: ["laeke"],
  ...overrides,
});

let test: TestDatabase;
let db: Database;

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  await seedTenant(db, uniquePlacesSeed);
});

afterEach(async () => {
  await test.close();
});

async function published(
  slug: string,
  overrides: Partial<ExplorePlaceFields> = {},
  sortOrder = 10,
) {
  const place = await createExplorePlace(db, up, { ...fields(slug, overrides), sortOrder });
  await setExplorePlaceStatus(db, up, place.id, "published", now);
  return place;
}

describe("EXPLORE from the database", () => {
  it("shows the guest's property only, published only, in editorial order", async () => {
    await published("hafen", { category: "sights" }, 30);
    await published("seebad", { category: "wellness" }, 20);
    await published("highlight", { featured: true }, 90);
    await published("nur-hov", { propertyIds: ["hov"] });
    await published("ohne-objekt", { propertyIds: [] });
    await createExplorePlace(db, up, { ...fields("entwurf"), sortOrder: 1 });
    const archived = await published("archiviert");
    await setExplorePlaceStatus(db, up, archived.id, "archived", now);

    const places = await loadExplorePlaces(db, guestOf("laeke"), logger);
    expect(places.map((place) => place.slug.de)).toEqual(["highlight", "seebad", "hafen"]);
    expect(categoriesOf(places, EXPLORE_CATEGORIES)).toEqual(["food-drink", "wellness", "sights"]);
    expect((await loadExplorePlaces(db, guestOf("hov"), logger)).map((p) => p.slug.de)).toEqual([
      "nur-hov",
    ]);
  });

  it("never shows places of another tenant", async () => {
    await published("eigen");
    const foreignGuest = guestOf("laeke", "other-tenant");
    expect(await loadExplorePlaces(db, foreignGuest, logger)).toEqual([]);
  });

  it("resolves cards and details per locale with German fallback and only existing actions", async () => {
    await published("seecafe", {
      title: { de: "Seecafé", en: "Lake café" },
      teaser: { de: "Kaffee am Wasser" },
      description: { de: "Erster Absatz.\n\nZweiter Absatz." },
      tip: { de: "Unbedingt den Apfelstrudel probieren.", en: "Try the apple strudel." },
      locality: "Lindau",
      phone: "+49 8382 12345",
      heroImage: {
        src: "/fixtures/explore/inn-interior.webp",
        width: 888,
        height: 560,
        alt: { de: "Gaststube" },
      },
    });
    const [place] = await loadExplorePlaces(db, guestOf("laeke"), logger);
    if (!place) throw new Error("place missing");

    const de = createExploreResolver("de");
    expect(de.card(place)).toMatchObject({
      href: "/explore/seecafe",
      title: "Seecafé",
      teaser: "Kaffee am Wasser",
      category: "food-drink",
      locality: "Lindau",
      image: { alt: "Gaststube" },
    });
    const en = createExploreResolver("en");
    expect(en.card(place)).toMatchObject({ href: "/explore/seecafe-en", title: "Lake café" });
    // Missing English falls back to German – no invented translation.
    expect(en.card(place).teaser).toBe("Kaffee am Wasser");
    const detail = en.detail(place);
    expect(detail.description).toEqual(["Erster Absatz.", "Zweiter Absatz."]);
    expect(detail.tip).toBe("Try the apple strudel.");
    expect(detail.actions.map((action) => action.kind)).toEqual(["call"]);
    expect(detail.address).toBeUndefined();
    expect(detail.openingHours).toBeUndefined();
  });

  it("reflects admin changes at once and hides a place when its assignment is removed", async () => {
    const place = await published("wechsel");
    expect(await loadExplorePlaces(db, guestOf("laeke"), logger)).toHaveLength(1);
    await updateExplorePlace(db, up, place.id, fields("wechsel", { propertyIds: ["hov"] }));
    expect(await loadExplorePlaces(db, guestOf("laeke"), logger)).toEqual([]);
    expect(await loadExplorePlaces(db, guestOf("hov"), logger)).toHaveLength(1);
  });

  it("is empty without a database or when loading fails (no fake fallback)", async () => {
    expect(await loadExplorePlaces(undefined, guestOf("laeke"), logger)).toEqual([]);
    const broken = {
      select: () => {
        throw new Error("connection lost");
      },
    } as unknown as Database;
    expect(await loadExplorePlaces(broken, guestOf("laeke"), logger)).toEqual([]);
  });
});
