import { describe, expect, it } from "vitest";

import {
  type GuideBlock,
  type GuideEntry,
  type GuideOverride,
  type GuideTopic,
} from "./guide-model";
import { type GuideContext, resolveGuideSections } from "./resolve-guide-sections";

const paragraph = (id: string, de: string, en?: string): GuideBlock => ({
  id,
  type: "paragraph",
  text: en ? { de, en } : { de },
});

function topic(key: string, overrides: Partial<GuideTopic> = {}): GuideTopic {
  return {
    kind: "topic",
    id: `topic-${key}`,
    tenantId: "unique-places",
    key,
    scope: { level: "property", propertyId: "hov" },
    status: "published",
    translationState: {},
    sortOrder: 0,
    icon: "info",
    slug: { de: key, en: key },
    title: { de: key.toUpperCase(), en: key.toUpperCase() },
    shortDescription: { de: "" },
    blocks: [paragraph(`${key}-default`, `Standard ${key}`)],
    ...overrides,
  };
}

function override(
  key: string,
  unitId: string,
  overrides: Partial<GuideOverride> = {},
): GuideOverride {
  return {
    kind: "override",
    id: `override-${key}-${unitId}`,
    tenantId: "unique-places",
    key,
    scope: { level: "unit", propertyId: "hov", unitId },
    status: "published",
    translationState: {},
    blocks: [paragraph(`${key}-${unitId}`, `Inhalt ${unitId}`, `Content ${unitId}`)],
    ...overrides,
  };
}

const at = (unitId: string | undefined): GuideContext => ({
  tenantId: "unique-places",
  propertyId: "hov",
  ...(unitId ? { unitId } : {}),
  now: new Date("2026-10-10T12:00:00+02:00"),
  access: "reservation",
  stay: { checkInAt: "2026-10-08T16:00:00+02:00", checkOutAt: "2026-10-13T10:00:00+02:00" },
});

const texts = (entries: readonly GuideEntry[], unitId: string | undefined) =>
  resolveGuideSections(entries, at(unitId)).map((section) => ({
    key: section.key,
    blocks: section.blocks.map((block) =>
      block.type === "paragraph" ? block.text.de : block.type,
    ),
  }));

const wifi = [topic("wifi"), override("wifi", "esl"), override("wifi", "ros")];

describe("resolveGuideSections (property → unit override)", () => {
  it("uses the property content when no override exists", () => {
    expect(texts([topic("arrival")], "esl")).toEqual([
      { key: "arrival", blocks: ["Standard arrival"] },
    ]);
  });

  it("replaces the content with the override of the same key – one topic only", () => {
    const sections = resolveGuideSections(wifi, at("esl"));
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      id: "topic-wifi",
      title: { de: "WIFI" },
      slug: { de: "wifi" },
    });
  });

  it("gives ESL the ESL content and ROS the ROS content", () => {
    expect(texts(wifi, "esl")).toEqual([{ key: "wifi", blocks: ["Inhalt esl"] }]);
    expect(texts(wifi, "ros")).toEqual([{ key: "wifi", blocks: ["Inhalt ros"] }]);
  });

  it("falls back to the property content for other units and without unit", () => {
    expect(texts(wifi, "kaz")).toEqual([{ key: "wifi", blocks: ["Standard wifi"] }]);
    expect(texts(wifi, undefined)).toEqual([{ key: "wifi", blocks: ["Standard wifi"] }]);
  });

  it("keeps title, slug, icon and order from the topic", () => {
    const [section] = resolveGuideSections(
      [
        topic("wifi", { icon: "wifi", sortOrder: 20, intro: { de: "Topic-Intro" } }),
        override("wifi", "esl", { intro: { de: "ESL-Intro" } }),
      ],
      at("esl"),
    );
    expect(section).toMatchObject({ icon: "wifi", sortOrder: 20, intro: { de: "ESL-Intro" } });
  });

  it("ignores unpublished overrides and overrides without a visible topic", () => {
    expect(texts([topic("wifi"), override("wifi", "esl", { status: "draft" })], "esl")).toEqual([
      { key: "wifi", blocks: ["Standard wifi"] },
    ]);
    expect(texts([override("wifi", "esl")], "esl")).toEqual([]);
    expect(texts([topic("wifi", { status: "draft" }), override("wifi", "esl")], "esl")).toEqual([]);
  });

  it("lets the most specific topic win (tenant default → property → unit)", () => {
    const tenantDefault = topic("house-rules", {
      id: "tenant-rules",
      scope: { level: "tenant" },
      blocks: [paragraph("t", "Tenant")],
    });
    const entries = [
      tenantDefault,
      topic("house-rules", { id: "hov-rules", blocks: [paragraph("p", "HØV")] }),
      topic("sauna", { scope: { level: "unit", propertyId: "hov", unitId: "esl" } }),
    ];
    expect(texts(entries, "esl")).toEqual([
      { key: "house-rules", blocks: ["HØV"] },
      { key: "sauna", blocks: ["Standard sauna"] },
    ]);
    expect(texts(entries, "ros")).toEqual([{ key: "house-rules", blocks: ["HØV"] }]);
    expect(texts([tenantDefault], "ros")).toEqual([{ key: "house-rules", blocks: ["Tenant"] }]);
  });

  it("never shows content of another tenant or another property", () => {
    const entries = [
      topic("wifi", { tenantId: "other-tenant" }),
      override("wifi", "esl", { tenantId: "other-tenant" }),
      topic("arrival", { scope: { level: "property", propertyId: "huesle" } }),
    ];
    expect(texts(entries, "esl")).toEqual([]);
    // An override of another tenant never replaces our own topic's content.
    expect(
      texts([topic("wifi"), override("wifi", "esl", { tenantId: "other-tenant" })], "esl"),
    ).toEqual([{ key: "wifi", blocks: ["Standard wifi"] }]);
  });

  it("hides draft and archived topics", () => {
    expect(
      texts([topic("a", { status: "draft" }), topic("b", { status: "archived" })], "esl"),
    ).toEqual([]);
  });

  it("keeps the order of the topics", () => {
    const entries = [
      topic("c", { sortOrder: 30 }),
      topic("a", { sortOrder: 10 }),
      topic("b", { sortOrder: 20 }),
    ];
    expect(resolveGuideSections(entries, at("esl")).map((section) => section.key)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("respects topic and block visibility", () => {
    const doorCode: GuideBlock = {
      ...paragraph("code", "Code"),
      visibility: { from: { type: "stay", anchor: "check-in", offsetMinutes: 0 } },
    };
    const entries = [
      topic("arrival", { blocks: [paragraph("always", "Immer"), doorCode] }),
      topic("later", { visibility: { from: { type: "absolute", at: "2027-01-01T00:00:00Z" } } }),
    ];
    expect(texts(entries, "esl")).toEqual([{ key: "arrival", blocks: ["Immer", "Code"] }]);
    const before = { ...at("esl"), now: new Date("2026-10-01T12:00:00+02:00") };
    expect(resolveGuideSections(entries, before)[0]?.blocks).toHaveLength(1);
  });
});
