import { type ExplorePlace } from "@up/core";
import { describe, expect, it } from "vitest";

import { hovExplorePlaces } from "../../mocks/explore/hov-explore";
import { createExploreResolver } from "./resolve-explore";

const place: ExplorePlace = {
  id: "inn",
  tenantId: "unique-places",
  scope: { level: "properties", propertyIds: ["hov"] },
  status: "published",
  slug: { de: "beispiel-gasthaus", en: "sample-inn" },
  title: { de: "Beispiel-Gasthaus", en: "Sample inn" },
  categories: ["food-drink", "family"],
  shortDescription: { de: "Regionale Küche" },
  images: [
    { src: "/inn.webp", width: 800, height: 500, alt: { de: "Gaststube", en: "Dining room" } },
  ],
  website: "https://example.com",
  sortOrder: 1,
  featured: true,
};

describe("createExploreResolver", () => {
  it("builds cards with localized slugs and German fallback", () => {
    expect(createExploreResolver("de").card(place)).toMatchObject({
      href: "/explore/beispiel-gasthaus",
      title: "Beispiel-Gasthaus",
    });
    const en = createExploreResolver("en").card(place);
    expect(en).toMatchObject({
      href: "/explore/sample-inn",
      title: "Sample inn",
      description: "Regionale Küche",
    });
    expect(en.image.alt).toBe("Dining room");
  });

  it("uses the main category and only existing actions on the detail page", () => {
    const detail = createExploreResolver("de").detail(place);
    expect(detail.category).toBe("food-drink");
    expect(detail.actions.map((a) => a.kind)).toEqual(["website"]);
    expect(detail).toMatchObject({
      address: undefined,
      openingHours: undefined,
      recommendation: undefined,
      description: [],
    });
  });

  it("resolves a slug only in its own locale", () => {
    const de = createExploreResolver("de");
    const en = createExploreResolver("en");
    expect(hovExplorePlaces.find((p) => de.slug(p) === "beispiel-gasthaus")?.id).toBe("sample-inn");
    expect(hovExplorePlaces.find((p) => en.slug(p) === "beispiel-gasthaus")).toBeUndefined();
    expect(hovExplorePlaces.find((p) => de.slug(p) === "unbekannt")).toBeUndefined();
  });

  it("mock content has unique slugs per locale and only fictitious entries", () => {
    for (const locale of ["de", "en"] as const) {
      const slugs = hovExplorePlaces.map((p) => createExploreResolver(locale).slug(p));
      expect(new Set(slugs).size).toBe(slugs.length);
    }
    for (const p of hovExplorePlaces) {
      expect(p.title.de).toMatch(/^Beispiel-/);
      expect(p.title.en).toMatch(/^Sample /);
    }
  });
});
