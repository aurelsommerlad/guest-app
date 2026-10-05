import { describe, expect, it } from "vitest";

import { type ExplorePlace } from "./explore-model";
import {
  type ExploreContext,
  filterPlacesByCategory,
  selectExplorePlaces,
} from "./select-explore-places";

function place(overrides: Partial<ExplorePlace> & Pick<ExplorePlace, "id">): ExplorePlace {
  return {
    tenantId: "unique-places",
    scope: { level: "properties", propertyIds: ["hov"] },
    status: "published",
    slug: { de: overrides.id },
    title: { de: overrides.id },
    categories: ["nature"],
    shortDescription: { de: "" },
    images: [{ src: "/x.webp", width: 10, height: 10, alt: { de: "" } }],
    sortOrder: 0,
    featured: false,
    ...overrides,
  };
}

const context: ExploreContext = {
  tenantId: "unique-places",
  propertyId: "hov",
  now: new Date("2026-08-29T12:00:00+02:00"),
  access: "reservation",
};

describe("selectExplorePlaces", () => {
  it("puts featured places first, then sorts by sortOrder", () => {
    const result = selectExplorePlaces(
      [
        place({ id: "c", sortOrder: 1 }),
        place({ id: "b", sortOrder: 9, featured: true }),
        place({ id: "a", sortOrder: 0 }),
      ],
      context,
    );
    expect(result.map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  it("applies the property scope, including places shared by several properties", () => {
    const result = selectExplorePlaces(
      [
        place({ id: "hov-only" }),
        place({ id: "laeke-only", scope: { level: "properties", propertyIds: ["laeke"] } }),
        place({ id: "shared", scope: { level: "properties", propertyIds: ["laeke", "hov"] } }),
        place({ id: "tenant-wide", scope: { level: "tenant" } }),
      ],
      context,
    );
    expect(result.map((p) => p.id).sort()).toEqual(["hov-only", "shared", "tenant-wide"]);
  });

  it("excludes drafts and other tenants", () => {
    expect(
      selectExplorePlaces(
        [place({ id: "draft", status: "draft" }), place({ id: "other", tenantId: "other" })],
        context,
      ),
    ).toEqual([]);
  });

  it("respects visibility windows", () => {
    const summerOnly = place({
      id: "summer",
      visibility: {
        from: { type: "absolute", at: "2026-06-01T00:00:00Z" },
        until: { type: "absolute", at: "2026-08-01T00:00:00Z" },
      },
    });
    expect(selectExplorePlaces([summerOnly], context)).toEqual([]);
  });
});

describe("filterPlacesByCategory", () => {
  const places = [
    place({ id: "inn", categories: ["food-drink"] }),
    place({ id: "trail", categories: ["active", "nature", "family"] }),
    place({ id: "museum", categories: ["culture"] }),
  ];

  it("returns everything for 'all'", () => {
    expect(filterPlacesByCategory(places, "all").map((p) => p.id)).toEqual([
      "inn",
      "trail",
      "museum",
    ]);
  });

  it("matches any of a place's categories", () => {
    expect(filterPlacesByCategory(places, "family").map((p) => p.id)).toEqual(["trail"]);
    expect(filterPlacesByCategory(places, "nature").map((p) => p.id)).toEqual(["trail"]);
    expect(filterPlacesByCategory(places, "food-drink").map((p) => p.id)).toEqual(["inn"]);
  });
});
