import { createLogger } from "@up/core";
import {
  createGuideOverride,
  createGuideTopic,
  type Database,
  seedTenant,
  setGuideEntryStatus,
  uniquePlacesSeed,
  updateGuideContent,
} from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findPropertyById } from "../../config/properties";
import { type GuestContext } from "../guest-context/guest-context";
import { loadGuideSections } from "./guide-content";
import { createGuideResolver } from "./resolve-guide";

const logger = createLogger({ sink: () => undefined });
const up = { tenantId: "unique-places" };
const now = new Date("2026-10-10T12:00:00+02:00");

function guestIn(unitId: string): GuestContext {
  const property = findPropertyById("hov");
  if (!property) throw new Error("hov missing");
  return {
    mode: "guest",
    tenantId: "unique-places",
    propertyId: "hov",
    unitId,
    reservationProvider: "apaleo",
    externalReservationId: "IHESZZFV-1",
    property,
    now,
    reservation: { status: "unavailable" },
  };
}

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

const paragraphs = (sections: Awaited<ReturnType<typeof loadGuideSections>>) =>
  sections.map((section) =>
    section.blocks.map((block) => (block.type === "paragraph" ? block.text.de : block.type)).join(),
  );

describe("GUIDE for the Apaleo TEST property (content source HØV)", () => {
  function testGuest(unitId: string, tenantId = "unique-places"): GuestContext {
    const property = findPropertyById("test-run");
    if (!property) throw new Error("test-run missing");
    return { ...guestIn("ros"), tenantId, propertyId: "test-run", unitId, property };
  }

  it("shows HØV's published content – Ap. 1 with the ROS variant, Ap. 2 the general one", async () => {
    const wifi = await createGuideTopic(db, up, {
      key: "wifi",
      scope: { level: "property", propertyId: "hov" },
      sortOrder: 20,
      icon: "wifi",
      slug: { de: "wlan", en: "wifi" },
      title: { de: "WLAN", en: "Wi-Fi" },
      shortDescription: { de: "Netzwerk", en: "Network" },
      blocks: [{ id: "p", type: "paragraph", text: { de: "Allgemein", en: "General" } }],
      translationState: {},
    });
    const ros = await createGuideOverride(db, up, {
      key: "wifi",
      scope: { level: "unit", propertyId: "hov", unitId: "ros" },
      blocks: [{ id: "p", type: "paragraph", text: { de: "Nur ROS", en: "ROS only" } }],
      translationState: {},
    });
    const draft = await createGuideTopic(db, up, {
      key: "draft",
      scope: { level: "property", propertyId: "hov" },
      sortOrder: 30,
      icon: "info",
      slug: { de: "entwurf", en: "draft" },
      title: { de: "Entwurf" },
      shortDescription: { de: "Noch nicht live" },
      blocks: [],
      translationState: {},
    });
    await setGuideEntryStatus(db, up, wifi.id, "published", now);
    await setGuideEntryStatus(db, up, ros.id, "published", now);

    expect(paragraphs(await loadGuideSections(db, testGuest("test-ap-1"), logger))).toEqual([
      "Nur ROS",
    ]);
    expect(paragraphs(await loadGuideSections(db, testGuest("test-ap-2"), logger))).toEqual([
      "Allgemein",
    ]);
    // Drafts stay drafts – the link shows exactly what HØV guests see.
    expect(draft.status).toBe("draft");
    // A context of another tenant never reaches HØV's content through the link.
    expect(await loadGuideSections(db, testGuest("test-ap-1", "other-tenant"), logger)).toEqual(
      [],
    );
  });
});

describe("GUIDE from the database", () => {
  it("shows the DB content for the guest context with the unit override (ESL)", async () => {
    const wifi = await createGuideTopic(db, up, {
      key: "wifi",
      scope: { level: "property", propertyId: "hov" },
      sortOrder: 20,
      icon: "wifi",
      slug: { de: "wlan", en: "wifi" },
      title: { de: "WLAN", en: "Wi-Fi" },
      shortDescription: { de: "Netzwerk und Passwort", en: "Network and password" },
      blocks: [{ id: "p", type: "paragraph", text: { de: "Allgemein", en: "General" } }],
      translationState: {},
    });
    const esl = await createGuideOverride(db, up, {
      key: "wifi",
      scope: { level: "unit", propertyId: "hov", unitId: "esl" },
      blocks: [{ id: "p", type: "paragraph", text: { de: "Nur ESL", en: "ESL only" } }],
      translationState: {},
    });
    await setGuideEntryStatus(db, up, wifi.id, "published", now);
    await setGuideEntryStatus(db, up, esl.id, "published", now);

    const forEsl = await loadGuideSections(db, guestIn("esl"), logger);
    expect(paragraphs(forEsl)).toEqual(["Nur ESL"]);
    expect(paragraphs(await loadGuideSections(db, guestIn("ros"), logger))).toEqual(["Allgemein"]);

    // DE/EN resolution of the same content.
    const [en] = forEsl.map(createGuideResolver("en").article);
    const [de] = forEsl.map(createGuideResolver("de").article);
    expect(en?.title).toBe("Wi-Fi");
    expect(de?.title).toBe("WLAN");
    expect(en?.blocks[0]).toMatchObject({ type: "paragraph", text: "ESL only" });
  });

  it("shows changes made in the admin right away and hides unpublished topics", async () => {
    const arrival = await createGuideTopic(db, up, {
      key: "arrival",
      scope: { level: "property", propertyId: "hov" },
      sortOrder: 10,
      icon: "car",
      slug: { de: "ankunft" },
      title: { de: "Ankunft" },
      shortDescription: { de: "Anreise" },
      blocks: [{ id: "p", type: "paragraph", text: { de: "Alt" } }],
      translationState: {},
    });
    expect(await loadGuideSections(db, guestIn("esl"), logger)).toEqual([]);

    await setGuideEntryStatus(db, up, arrival.id, "published", now);
    expect(paragraphs(await loadGuideSections(db, guestIn("esl"), logger))).toEqual(["Alt"]);

    await updateGuideContent(db, up, arrival.id, {
      blocks: [{ id: "p", type: "paragraph", text: { de: "Neu" } }],
      translationState: {},
    });
    expect(paragraphs(await loadGuideSections(db, guestIn("esl"), logger))).toEqual(["Neu"]);

    await setGuideEntryStatus(db, up, arrival.id, "archived", now);
    expect(await loadGuideSections(db, guestIn("esl"), logger)).toEqual([]);
  });

  it("is empty without a database", async () => {
    expect(await loadGuideSections(undefined, guestIn("esl"), logger)).toEqual([]);
  });
});
