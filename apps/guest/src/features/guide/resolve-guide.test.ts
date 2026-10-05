import { type GuideSection } from "@up/core";
import { describe, expect, it } from "vitest";

import { createGuideResolver } from "./resolve-guide";

const section: GuideSection = {
  id: "hov-arrival-parking",
  tenantId: "unique-places",
  key: "arrival-parking",
  scope: { level: "property", propertyId: "hov" },
  status: "published",
  slug: { de: "ankunft-parken", en: "arrival-parking" },
  eyebrow: { de: "Ankunft", en: "Arrival" },
  title: { de: "Ankunft & Parken", en: "Arrival & parking" },
  shortDescription: { de: "Anreise, Parken und Self-Check-in" },
  icon: "car",
  sortOrder: 10,
  heroImage: { src: "/house.webp", width: 800, height: 500, alt: { de: "Das Haus" } },
  blocks: [
    { id: "h", type: "heading", text: { de: "Parken", en: "Parking" } },
    {
      id: "l",
      type: "list",
      style: "bullet",
      items: [{ de: "Check-in ab 16:00 Uhr", en: "Check-in from 4 pm" }],
    },
    { id: "c", type: "callout", text: { de: "Hinweis" } },
    { id: "a", type: "action", action: "phone", label: { de: "Anrufen" }, value: "+49" },
  ],
};

describe("createGuideResolver", () => {
  it("builds overview items with localized hrefs", () => {
    expect(createGuideResolver("de").overviewItem(section)).toEqual({
      id: "hov-arrival-parking",
      href: "/guide/ankunft-parken",
      title: "Ankunft & Parken",
      description: "Anreise, Parken und Self-Check-in",
      icon: "car",
    });
    expect(createGuideResolver("en").overviewItem(section).href).toBe("/guide/arrival-parking");
  });

  it("resolves articles and every block type for the locale, with German fallback", () => {
    const article = createGuideResolver("en").article(section);
    expect(article).toMatchObject({
      title: "Arrival & parking",
      eyebrow: "Arrival",
      intro: undefined,
    });
    expect(article.heroImage).toMatchObject({ src: "/house.webp", alt: "Das Haus" });
    expect(article.blocks).toEqual([
      { id: "h", type: "heading", text: "Parking" },
      { id: "l", type: "list", style: "bullet", items: ["Check-in from 4 pm"] },
      { id: "c", type: "callout", title: undefined, text: "Hinweis" },
      { id: "a", type: "action", action: "phone", label: "Anrufen", value: "+49" },
    ]);
  });
});
