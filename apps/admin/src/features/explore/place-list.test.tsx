import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { matchesFilter, topicCounts } from "../guide/topic-list";
import { ExplorePlaceList, type ListedPlace } from "./components/ExplorePlaceList";
import { CATEGORY_LABELS, type PropertyOption } from "./explore-admin-service";
import { filterPlaces, searchPlaces } from "./place-list";

const properties: PropertyOption[] = [
  { id: "hov", displayName: "HØV", spokenName: "Höv", locationName: "Altusried" },
  { id: "laeke", displayName: "LÆKE", spokenName: "Läke", locationName: "Lindau" },
];

function place(overrides: Partial<ListedPlace> & Pick<ListedPlace, "id">): ListedPlace {
  return {
    title: { de: overrides.id },
    teaser: { de: "Teaser" },
    category: "food-drink",
    status: "published",
    featured: false,
    propertyIds: ["laeke"],
    englishComplete: true,
    ...overrides,
  };
}

const places: ListedPlace[] = [
  place({
    id: "seecafe",
    position: 1,
    title: { de: "Seecafé", en: "Lake café" },
    teaser: { de: "Kaffee am Wasser" },
    locality: "Lindau",
    heroImageSrc: "/fixtures/explore/inn-interior.webp",
    featured: true,
    propertyIds: ["hov", "laeke"],
  }),
  place({
    id: "museum",
    position: 2,
    category: "sights",
    status: "draft",
    title: { de: "Stadtmuseum" },
    description: { de: "Geschichte der Inselstadt" },
    address: "Marktplatz 1\n88131 Lindau",
    englishComplete: false,
  }),
  place({
    id: "hofladen",
    position: 3,
    category: "shopping",
    title: { de: "Hofladen" },
    propertyIds: [],
  }),
  place({ id: "alt", status: "archived", title: { de: "Alte Bar" } }),
];

describe("explore list filters", () => {
  it("filters by category and property, including places without assignment", () => {
    const ids = (filter: Parameters<typeof filterPlaces>[1]) =>
      filterPlaces(places, filter).map((p) => p.id);
    expect(ids({ category: "sights", property: "all" })).toEqual(["museum"]);
    expect(ids({ category: "all", property: { propertyId: "hov" } })).toEqual(["seecafe"]);
    expect(ids({ category: "all", property: "unassigned" })).toEqual(["hofladen"]);
    expect(ids({ category: "food-drink", property: { propertyId: "laeke" } })).toEqual([
      "seecafe",
      "alt",
    ]);
  });

  it("searches title, teaser, description and place (DE/EN, accent-insensitive)", () => {
    const ids = (query: string) => searchPlaces(places, query).map((p) => p.id);
    expect(ids("lake")).toEqual(["seecafe"]);
    expect(ids("SEECAFE")).toEqual(["seecafe"]);
    expect(ids("inselstadt")).toEqual(["museum"]);
    expect(ids("marktplatz")).toEqual(["museum"]);
    expect(ids("lindau")).toEqual(["seecafe", "museum"]);
    expect(ids("sauna")).toEqual([]);
  });
});

function list(viewProperty: string | null, filter: "all" | "archived" = "all") {
  return renderToStaticMarkup(
    <ExplorePlaceList
      base={viewProperty ? `/explore/${viewProperty}` : "/explore"}
      viewProperty={viewProperty}
      filter={filter}
      counts={topicCounts(places)}
      places={places.filter((item) => matchesFilter(item.status, filter))}
      properties={properties}
      categoryLabels={CATEGORY_LABELS}
      hrefOf={Object.fromEntries(places.map((item) => [item.id, `/explore/places/${item.id}`]))}
      moveAction={async () => {
        /* server action stand-in */
      }}
      lastPosition={3}
    />,
  );
}

describe("explore content list", () => {
  it("shows image or calm icon, category · place, assignment, status and highlight", () => {
    const markup = list(null);
    expect(markup.match(/<li class="group relative/g)).toHaveLength(3);
    expect(markup.match(/<img /g)).toHaveLength(1);
    expect(markup).toContain("Essen &amp; Trinken · Lindau");
    expect(markup).toContain("HØV, LÆKE");
    expect(markup).toContain("Keinem Objekt zugeordnet");
    expect(markup).toContain("Highlight");
    expect(markup).toContain("bg-status-draft");
    expect(markup).toContain("EN unvollständig");
    expect(markup).toContain('href="/explore/places/seecafe"');
    expect(markup).not.toContain("Alte Bar");
  });

  it("offers the property filter only in the Alle Objekte view, plus category filter and search", () => {
    const all = list(null);
    expect(all).toContain("Ohne Objekt-Zuordnung");
    expect(all).toContain("Alle Kategorien");
    expect(all).toContain('placeholder="Empfehlungen durchsuchen …"');
    const hov = list("hov");
    expect(hov).not.toContain("Ohne Objekt-Zuordnung");
    expect(hov).toContain("Alle Kategorien");
  });

  it("counts tabs from the real places and reorders only in the full list", () => {
    const markup = list(null);
    expect(markup).toMatch(/Alle<span[^>]*>3<\/span>/);
    expect(markup).toMatch(/Archiviert<span[^>]*>1<\/span>/);
    expect(markup).toContain("nach oben");
    const archived = list(null, "archived");
    expect(archived).toContain("Alte Bar");
    expect(archived).not.toContain("nach oben");
  });
});
