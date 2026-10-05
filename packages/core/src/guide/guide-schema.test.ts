import { describe, expect, it } from "vitest";

import { guideContentSchema, slugify } from "./guide-schema";

const schema = guideContentSchema((src) => src.startsWith("https://media.example/"));

describe("guide content schema", () => {
  it("accepts structured content and drops empty optional texts", () => {
    const parsed = schema.parse({
      intro: { de: "", en: "" },
      blocks: [
        { id: "h", type: "heading", text: { de: "Titel", en: "" } },
        { id: "c", type: "callout", title: {}, text: { de: "Hinweis" } },
      ],
    });
    expect(parsed.intro).toBeUndefined();
    expect(parsed.blocks[0]).toEqual({ id: "h", type: "heading", text: { de: "Titel" } });
    expect(parsed.blocks[1]).toEqual({
      id: "c",
      type: "callout",
      title: undefined,
      text: { de: "Hinweis" },
    });
  });

  it("rejects HTML-free violations: unknown fields, missing German, foreign images, script links", () => {
    expect(
      schema.safeParse({ blocks: [{ id: "p", type: "paragraph", text: { en: "x" } }] }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ blocks: [{ id: "p", type: "html", html: "<b>x</b>" }] }).success,
    ).toBe(false);
    expect(schema.safeParse({ blocks: [], extra: true }).success).toBe(false);
    expect(
      schema.safeParse({
        blocks: [
          {
            id: "i",
            type: "image",
            image: { src: "https://evil.example/a.png", width: 1, height: 1, alt: { de: "a" } },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        blocks: [{ id: "l", type: "link", label: { de: "x" }, href: "javascript:alert(1)" }],
      }).success,
    ).toBe(false);
  });

  it("slugifies German titles", () => {
    expect(slugify("Ankunft & Parken")).toBe("ankunft-parken");
    expect(slugify("Müll & Recycling")).toBe("muell-recycling");
    expect(slugify("Heizung & Lüften")).toBe("heizung-lueften");
    expect(slugify("Wi-Fi")).toBe("wi-fi");
  });
});
