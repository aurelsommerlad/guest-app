import { createLogger, resolveGuideSections } from "@up/core";
import { type Database, listPublishedGuideEntries, seedTenant, uniquePlacesSeed } from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fromEditorContent, toEditorContent } from "./components/content-mapping";
import {
  changeStatus,
  createOverride,
  createTopic,
  deleteEntry,
  type GuideAdminDeps,
  loadGuideEntry,
  loadPropertyGuide,
  moveTopic,
  type NewTopicInput,
  updateContent,
  updateTopic,
} from "./guide-admin-service";

const up = { tenantId: "unique-places" };
const MEDIA = "https://abc.supabase.co/storage/v1/object/public/guide-media/";
let test: TestDatabase;
let db: Database;
let deps: GuideAdminDeps;

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
        displayName: "Other",
        spokenName: "Other",
        locationName: "Ort",
        timezone: "Europe/Berlin",
      },
    ],
  });
  deps = {
    db,
    logger: createLogger({ sink: () => undefined }),
    now: () => new Date("2026-10-10T08:00:00Z"),
    isAllowedImageSrc: (src, target) =>
      src.startsWith(`${MEDIA}${target.tenantId}/${target.propertyId}/`),
  };
});

afterEach(async () => {
  await test.close();
});

const wifiInput: NewTopicInput = {
  titleDe: "WLAN",
  titleEn: "Wi-Fi",
  shortDescriptionDe: "Netzwerk und Passwort",
  shortDescriptionEn: "Network and password",
  icon: "wifi",
  scope: "property",
};

const content = (de: string, en?: string) =>
  JSON.stringify({
    intro: { de: "" },
    blocks: [{ id: "p1", type: "paragraph", text: en ? { de, en } : { de } }],
  });

async function guestGuide(unitId: string) {
  const entries = await listPublishedGuideEntries(db, up, { propertyId: "hov", unitId });
  return resolveGuideSections(entries, {
    tenantId: "unique-places",
    propertyId: "hov",
    unitId,
    now: new Date(),
    access: "reservation",
  }).map((section) => ({
    title: section.title.de,
    text: section.blocks[0]?.type === "paragraph" ? section.blocks[0].text.de : undefined,
  }));
}

describe("GUIDE administration", () => {
  it("creates a topic with key and slug, edits and publishes it – visible in GUIDE afterwards", async () => {
    const created = await createTopic(deps, up, "hov", wifiInput);
    if (!created.ok) throw new Error(created.error);
    const loaded = await loadGuideEntry(deps, up, created.id);
    expect(loaded?.entry).toMatchObject({
      key: "wlan",
      kind: "topic",
      status: "draft",
      slug: { de: "wlan", en: "wi-fi" },
    });

    expect(
      await updateContent(
        deps,
        up,
        created.id,
        content("Allgemeine WLAN-Info", "General Wi-Fi info"),
      ),
    ).toEqual({ ok: true });
    expect(await guestGuide("esl")).toEqual([]); // draft is not public

    await changeStatus(deps, up, created.id, "published");
    expect(await guestGuide("esl")).toEqual([{ title: "WLAN", text: "Allgemeine WLAN-Info" }]);

    // A later admin change is live at once.
    await updateContent(deps, up, created.id, content("Neue WLAN-Info"));
    expect(await guestGuide("esl")).toEqual([{ title: "WLAN", text: "Neue WLAN-Info" }]);
  });

  it("adds ESL and ROS variants; other apartments fall back to the general content", async () => {
    const created = await createTopic(deps, up, "hov", wifiInput);
    if (!created.ok) throw new Error(created.error);
    await updateContent(deps, up, created.id, content("Allgemein"));
    await changeStatus(deps, up, created.id, "published");

    const esl = await createOverride(deps, up, created.id, "esl");
    const ros = await createOverride(deps, up, created.id, "ros");
    if (!esl.ok || !ros.ok) throw new Error("override failed");
    expect((await loadGuideEntry(deps, up, esl.id))?.entry.blocks).toHaveLength(1); // starts as a copy
    await updateContent(deps, up, esl.id, content("ESL-Zugang (vom Admin gepflegt)"));
    await updateContent(deps, up, ros.id, content("ROS-Zugang (vom Admin gepflegt)"));
    expect(await guestGuide("esl")).toEqual([{ title: "WLAN", text: "Allgemein" }]); // variant still draft
    await changeStatus(deps, up, esl.id, "published");
    await changeStatus(deps, up, ros.id, "published");

    expect(await guestGuide("esl")).toEqual([
      { title: "WLAN", text: "ESL-Zugang (vom Admin gepflegt)" },
    ]);
    expect(await guestGuide("ros")).toEqual([
      { title: "WLAN", text: "ROS-Zugang (vom Admin gepflegt)" },
    ]);
    expect(await guestGuide("kaz")).toEqual([{ title: "WLAN", text: "Allgemein" }]);

    const overview = await loadPropertyGuide(deps, up, "hov");
    expect(overview?.topics[0]?.overrides.map((item) => item.unitName)).toEqual(["ESL", "ROS"]);
    expect(await createOverride(deps, up, created.id, "esl")).toMatchObject({ ok: false });
    expect(await createOverride(deps, up, created.id, "unknown-unit")).toMatchObject({ ok: false });
  });

  it("archives a topic together with its variants and hides it", async () => {
    const created = await createTopic(deps, up, "hov", wifiInput);
    if (!created.ok) throw new Error(created.error);
    await changeStatus(deps, up, created.id, "published");
    const esl = await createOverride(deps, up, created.id, "esl");
    if (!esl.ok) throw new Error(esl.error);
    await changeStatus(deps, up, esl.id, "published");
    await changeStatus(deps, up, created.id, "archived");
    expect(await guestGuide("esl")).toEqual([]);
    expect((await loadGuideEntry(deps, up, esl.id))?.entry.status).toBe("archived");
    expect(await deleteEntry(deps, up, created.id)).toMatchObject({ ok: false });
  });

  it("deletes never-published drafts and keeps the order", async () => {
    const a = await createTopic(deps, up, "hov", { ...wifiInput, titleDe: "Ankunft", titleEn: "" });
    const b = await createTopic(deps, up, "hov", {
      ...wifiInput,
      titleDe: "Check-out",
      titleEn: "",
    });
    if (!a.ok || !b.ok) throw new Error("create failed");
    await moveTopic(deps, up, b.id, "up");
    expect(
      (await loadPropertyGuide(deps, up, "hov"))?.topics.map((topic) => topic.title.de),
    ).toEqual(["Check-out", "Ankunft"]);
    expect(await deleteEntry(deps, up, a.id)).toMatchObject({ ok: true });
    expect((await loadPropertyGuide(deps, up, "hov"))?.topics).toHaveLength(1);
  });

  it("validates input: German required, no foreign images, unique URL names", async () => {
    expect(await createTopic(deps, up, "hov", { ...wifiInput, titleDe: "" })).toMatchObject({
      ok: false,
    });
    const created = await createTopic(deps, up, "hov", wifiInput);
    if (!created.ok) throw new Error(created.error);
    expect(
      await updateContent(
        deps,
        up,
        created.id,
        JSON.stringify({ blocks: [{ id: "p", type: "paragraph", text: { en: "only English" } }] }),
      ),
    ).toMatchObject({ ok: false });
    expect(await updateContent(deps, up, created.id, "{not json")).toMatchObject({ ok: false });
    const foreignImage = {
      blocks: [
        {
          id: "i",
          type: "image",
          image: { src: "https://evil.example/x.png", width: 10, height: 10, alt: { de: "x" } },
        },
      ],
    };
    expect(await updateContent(deps, up, created.id, JSON.stringify(foreignImage))).toMatchObject({
      ok: false,
    });
    const otherProperty = {
      blocks: [
        {
          id: "i",
          type: "image",
          image: {
            src: `${MEDIA}unique-places/laeke/guide/a.png`,
            width: 10,
            height: 10,
            alt: { de: "x" },
          },
        },
      ],
    };
    expect(await updateContent(deps, up, created.id, JSON.stringify(otherProperty))).toMatchObject({
      ok: false,
    });
    const ownImage = {
      blocks: [
        {
          id: "i",
          type: "image",
          image: {
            src: `${MEDIA}unique-places/hov/guide/a.png`,
            width: 10,
            height: 10,
            alt: { de: "Router" },
          },
        },
      ],
    };
    expect(await updateContent(deps, up, created.id, JSON.stringify(ownImage))).toEqual({
      ok: true,
    });
    expect(
      await updateContent(
        deps,
        up,
        created.id,
        JSON.stringify({
          blocks: [{ id: "l", type: "link", label: { de: "x" }, href: "javascript:alert(1)" }],
        }),
      ),
    ).toMatchObject({ ok: false });

    const second = await createTopic(deps, up, "hov", {
      ...wifiInput,
      titleDe: "Internet",
      titleEn: "",
    });
    if (!second.ok) throw new Error(second.error);
    const meta = {
      titleDe: "Internet",
      titleEn: "",
      shortDescriptionDe: "x",
      shortDescriptionEn: "",
      eyebrowDe: "",
      eyebrowEn: "",
      slugEn: "",
      icon: "wifi",
    };
    expect(await updateTopic(deps, up, second.id, { ...meta, slugDe: "wlan" })).toMatchObject({
      ok: false,
    });
    expect(await updateTopic(deps, up, second.id, { ...meta, slugDe: "internet-zugang" })).toEqual({
      ok: true,
    });
  });

  it("tracks whether English is complete (prepared for later translation)", async () => {
    const created = await createTopic(deps, up, "hov", wifiInput);
    if (!created.ok) throw new Error(created.error);
    await updateContent(deps, up, created.id, content("Nur Deutsch"));
    expect((await loadGuideEntry(deps, up, created.id))?.entry.translationState).toEqual({
      en: "missing",
    });
    await updateContent(deps, up, created.id, content("Deutsch", "English"));
    expect((await loadGuideEntry(deps, up, created.id))?.entry.translationState).toEqual({
      en: "reviewed",
    });
  });

  it("never touches another tenant's properties or entries", async () => {
    const created = await createTopic(deps, up, "hov", wifiInput);
    if (!created.ok) throw new Error(created.error);
    const other = { tenantId: "other-tenant" };
    expect(await loadPropertyGuide(deps, other, "hov")).toBeUndefined();
    expect(await createTopic(deps, other, "hov", wifiInput)).toMatchObject({ ok: false });
    expect(await loadGuideEntry(deps, other, created.id)).toBeUndefined();
    expect(await updateContent(deps, other, created.id, content("Übernahme"))).toMatchObject({
      ok: false,
    });
    expect(await changeStatus(deps, other, created.id, "published")).toMatchObject({ ok: false });
    expect(await deleteEntry(deps, other, created.id)).toMatchObject({ ok: false });
  });

  it("round-trips content through the editor mapping", async () => {
    const created = await createTopic(deps, up, "hov", wifiInput);
    if (!created.ok) throw new Error(created.error);
    const raw = {
      intro: { de: "Intro", en: "Intro EN" },
      blocks: [
        { id: "h", type: "heading", text: { de: "Zugang" } },
        {
          id: "l",
          type: "list",
          style: "steps",
          items: [{ de: "Eins", en: "One" }, { de: "Zwei" }],
        },
        { id: "c", type: "callout", text: { de: "Hinweis" }, title: {} },
        { id: "k", type: "link", label: { de: "Mehr" }, href: "https://example.com" },
      ],
    };
    await updateContent(deps, up, created.id, JSON.stringify(raw));
    const entry = (await loadGuideEntry(deps, up, created.id))?.entry;
    if (!entry) throw new Error("missing");
    const again = JSON.stringify(fromEditorContent(toEditorContent(entry)));
    expect(await updateContent(deps, up, created.id, again)).toEqual({ ok: true });
    expect((await loadGuideEntry(deps, up, created.id))?.entry.blocks).toEqual(entry.blocks);
  });
});
