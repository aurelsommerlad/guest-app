import { describe, expect, it } from "vitest";

import { EXPLORE_CATEGORIES, type ExplorePlace } from "./explore-model";
import { explorePlaceSchema } from "./explore-schema";
import {
  categoriesOf,
  englishStateOf,
  filterPlacesByCategory,
  isPlaceVisibleFor,
  selectExplorePlaces,
} from "./select-explore-places";

function place(overrides: Partial<ExplorePlace> & Pick<ExplorePlace, "id">): ExplorePlace {
  return {
    tenantId: "unique-places",
    status: "published",
    category: "food-drink",
    slug: { de: overrides.id },
    title: { de: overrides.id },
    teaser: { de: "Teaser" },
    sortOrder: 10,
    featured: false,
    propertyIds: ["laeke"],
    translationState: {},
    ...overrides,
  };
}

const context = { tenantId: "unique-places", propertyId: "laeke" };

describe("explore selection", () => {
  it("shows only published places of the tenant that are assigned to the property", () => {
    const places = [
      place({ id: "ok" }),
      place({ id: "draft", status: "draft" }),
      place({ id: "archived", status: "archived" }),
      place({ id: "other-property", propertyIds: ["hov"] }),
      place({ id: "unassigned", propertyIds: [] }),
      place({ id: "other-tenant", tenantId: "other-tenant" }),
      place({ id: "two-properties", propertyIds: ["hov", "laeke"] }),
    ];
    expect(selectExplorePlaces(places, context).map((item) => item.id)).toEqual([
      "ok",
      "two-properties",
    ]);
    expect(isPlaceVisibleFor(place({ id: "x", propertyIds: ["hov", "laeke"] }), context)).toBe(
      true,
    );
  });

  it("orders highlights first, then by the admin's order, then by title", () => {
    const places = [
      place({ id: "c", sortOrder: 30 }),
      place({ id: "b", sortOrder: 10 }),
      place({ id: "a", sortOrder: 10 }),
      place({ id: "featured", sortOrder: 90, featured: true }),
    ];
    expect(selectExplorePlaces(places, context).map((item) => item.id)).toEqual([
      "featured",
      "a",
      "b",
      "c",
    ]);
  });

  it("filters by category and lists only categories that have places", () => {
    const places = [
      place({ id: "lake", category: "nature" }),
      place({ id: "inn", category: "food-drink" }),
      place({ id: "spa", category: "wellness" }),
    ];
    expect(filterPlacesByCategory(places, "nature").map((item) => item.id)).toEqual(["lake"]);
    expect(filterPlacesByCategory(places, "all")).toHaveLength(3);
    expect(categoriesOf(places, EXPLORE_CATEGORIES)).toEqual(["food-drink", "nature", "wellness"]);
  });

  it("knows whether English is complete", () => {
    expect(englishStateOf([{ de: "A", en: "A" }, undefined, { de: "B", en: "B" }])).toBe(
      "reviewed",
    );
    expect(englishStateOf([{ de: "A", en: "A" }, { de: "B" }])).toBe("missing");
  });
});

const schema = explorePlaceSchema((src) => src.startsWith("https://media.example.org/"));
const valid = {
  title: { de: "Seecafé", en: "Lake café" },
  slug: { de: "seecafe", en: "lake-cafe" },
  category: "food-drink",
  teaser: { de: "Kaffee am Wasser" },
  address: "Seepromenade 1\n88131 Lindau",
  locality: "Lindau",
  mapsUrl: "https://maps.google.com/?q=Lindau",
  websiteUrl: "https://seecafe.example.org",
  reservationUrl: "",
  phone: "+49 8382 123 45",
  featured: false,
  propertyIds: ["laeke", "laeke", "huesle"],
};

describe("explore validation", () => {
  it("accepts a complete place, turns empty fields into undefined and dedupes properties", () => {
    const result = schema.parse(valid);
    expect(result.reservationUrl).toBeUndefined();
    expect(result.propertyIds).toEqual(["laeke", "huesle"]);
    expect(result.teaser).toEqual({ de: "Kaffee am Wasser" });
  });

  it("rejects unsafe links, odd phone numbers, foreign images and unknown categories", () => {
    for (const patch of [
      { websiteUrl: "javascript:alert(1)" },
      { mapsUrl: "ftp://example.org" },
      { reservationUrl: "mailto:x@example.org" },
      { websiteUrl: "seecafe.de" },
      { phone: "call me" },
      { phone: "+" },
      { category: "nightlife" },
      { title: { de: "" } },
      { teaser: { en: "Only English" } },
      { propertyIds: ["../other-tenant"] },
      { propertyIds: ["Laeke"] },
      { heroImage: { src: "https://evil.example/x.jpg", width: 1, height: 1, alt: { de: "x" } } },
      { unknownField: true },
    ]) {
      expect(schema.safeParse({ ...valid, ...patch }).success, JSON.stringify(patch)).toBe(false);
    }
  });
});
