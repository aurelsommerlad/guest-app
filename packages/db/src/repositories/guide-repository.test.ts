import { generateSecret, hashPassword, hashSecret, resolveGuideSections } from "@up/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database } from "../client";
import { guideFixtures, seedGuideFixtures } from "../seed/guide-fixtures";
import { seedTenant } from "../seed/seed-tenant";
import { uniquePlacesSeed } from "../seed/unique-places";
import { createTestDatabase, expectConstraintViolation } from "../testing/test-database";
import {
  createAdminSession,
  createAdminUser,
  findAdminSessionByTokenHash,
  findAdminUserByEmail,
  revokeAdminSession,
} from "./admin-repository";
import {
  createGuideOverride,
  createGuideTopic,
  deleteUnpublishedGuideEntry,
  getGuideEntry,
  listGuideEntriesForProperty,
  listPublishedGuideEntries,
  type NewGuideTopic,
  setGuideEntryStatus,
  setGuideTopicOrder,
  updateGuideContent,
} from "./guide-repository";

let db: Database;
let close: () => Promise<void>;
const up = { tenantId: "unique-places" };
const other = { tenantId: "other-tenant" };
const now = new Date("2026-10-10T10:00:00Z");

const topic = (key: string, overrides: Partial<NewGuideTopic> = {}): NewGuideTopic => ({
  key,
  scope: { level: "property", propertyId: "hov" },
  sortOrder: 10,
  icon: "info",
  slug: { de: key },
  title: { de: key },
  shortDescription: { de: key },
  blocks: [{ id: "p", type: "paragraph", text: { de: `Standard ${key}` } }],
  translationState: {},
  ...overrides,
});

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
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
        units: [{ id: "other-esl", slug: "esl", displayName: "ESL" }],
      },
    ],
  });
});

afterAll(async () => {
  await close();
});

describe("guide_sections", () => {
  it("stores topics and overrides and resolves the unit content (ESL, ROS, fallback)", async () => {
    const wifi = await createGuideTopic(db, up, topic("wifi"));
    const esl = await createGuideOverride(db, up, {
      key: "wifi",
      scope: { level: "unit", propertyId: "hov", unitId: "esl" },
      blocks: [{ id: "p", type: "paragraph", text: { de: "ESL-Inhalt" } }],
      translationState: {},
    });
    const ros = await createGuideOverride(db, up, {
      key: "wifi",
      scope: { level: "unit", propertyId: "hov", unitId: "ros" },
      blocks: [{ id: "p", type: "paragraph", text: { de: "ROS-Inhalt" } }],
      translationState: {},
    });
    for (const entry of [wifi, esl, ros])
      await setGuideEntryStatus(db, up, entry.id, "published", now);

    const guide = async (unitId: string) => {
      const entries = await listPublishedGuideEntries(db, up, { propertyId: "hov", unitId });
      return resolveGuideSections(entries, {
        tenantId: "unique-places",
        propertyId: "hov",
        unitId,
        now,
        access: "reservation",
      })
        .filter((section) => section.key === "wifi")
        .map((section) =>
          section.blocks[0]?.type === "paragraph" ? section.blocks[0].text.de : "",
        );
    };
    expect(await guide("esl")).toEqual(["ESL-Inhalt"]);
    expect(await guide("ros")).toEqual(["ROS-Inhalt"]);
    expect(await guide("kaz")).toEqual(["Standard wifi"]);
  });

  it("loads only published entries of the tenant, property and unit", async () => {
    const draft = await createGuideTopic(db, up, topic("draft-topic"));
    const foreign = await createGuideTopic(
      db,
      other,
      topic("foreign", { scope: { level: "property", propertyId: "other-hov" } }),
    );
    await setGuideEntryStatus(db, other, foreign.id, "published", now);
    const entries = await listPublishedGuideEntries(db, up, { propertyId: "hov", unitId: "esl" });
    const ids = entries.map((entry) => entry.id);
    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(foreign.id);
    expect(entries.every((entry) => entry.tenantId === "unique-places")).toBe(true);
    // Another tenant cannot read, change or delete our entries.
    expect(await getGuideEntry(db, other, draft.id)).toBeUndefined();
    expect(
      await updateGuideContent(db, other, draft.id, { blocks: [], translationState: {} }),
    ).toBe(false);
    expect(await deleteUnpublishedGuideEntry(db, other, draft.id)).toBe(false);
    expect(await listPublishedGuideEntries(db, other, { propertyId: "hov" })).toEqual([]);
  });

  it("rejects overrides with topic fields, topics without title and foreign units", async () => {
    await expectConstraintViolation(
      db.execute(sql`INSERT INTO guide_sections (tenant_id, key, kind, scope_level, property_id, unit_id, title)
                     VALUES ('unique-places', 'x', 'override', 'unit', 'hov', 'esl', '{"de":"X"}')`),
      "guide_sections_override_shape",
    );
    await expectConstraintViolation(
      db.execute(sql`INSERT INTO guide_sections (tenant_id, key, kind, scope_level, property_id)
                     VALUES ('unique-places', 'x', 'topic', 'property', 'hov')`),
      "guide_sections_topic_shape",
    );
    await expectConstraintViolation(
      createGuideOverride(db, up, {
        key: "wifi",
        scope: { level: "unit", propertyId: "hov", unitId: "other-esl" },
        blocks: [],
        translationState: {},
      }),
      "guide_sections_unit_fkey",
    );
    await expectConstraintViolation(
      createGuideTopic(
        db,
        up,
        topic("x", { scope: { level: "property", propertyId: "other-hov" } }),
      ),
      "guide_sections_property_fkey",
    );
  });

  it("allows one live topic per key – archived ones free the key", async () => {
    const first = await createGuideTopic(db, up, topic("unique-key"));
    await expectConstraintViolation(
      createGuideTopic(db, up, topic("unique-key")),
      "guide_sections_live_key_idx",
    );
    await setGuideEntryStatus(db, up, first.id, "archived", now);
    await expect(createGuideTopic(db, up, topic("unique-key"))).resolves.toBeDefined();
  });

  it("deletes only never-published entries", async () => {
    const draft = await createGuideTopic(db, up, topic("delete-me"));
    expect(await deleteUnpublishedGuideEntry(db, up, draft.id)).toBe(true);
    const published = await createGuideTopic(db, up, topic("keep-me"));
    await setGuideEntryStatus(db, up, published.id, "published", now);
    await setGuideEntryStatus(db, up, published.id, "draft", now);
    expect(await deleteUnpublishedGuideEntry(db, up, published.id)).toBe(false);
    expect((await getGuideEntry(db, up, published.id))?.firstPublishedAt?.getTime()).toBe(
      now.getTime(),
    );
  });

  it("stores the topic order", async () => {
    const a = await createGuideTopic(db, up, topic("order-a"));
    const b = await createGuideTopic(db, up, topic("order-b"));
    await setGuideTopicOrder(db, up, [b.id, a.id]);
    const list = await listGuideEntriesForProperty(db, up, "hov");
    const keys = list.filter((entry) => entry.key.startsWith("order-")).map((entry) => entry.key);
    expect(keys).toEqual(["order-b", "order-a"]);
  });
});

describe("guide fixtures (local only)", () => {
  it("seeds the former mock topics idempotently", async () => {
    const fresh = await createTestDatabase();
    await seedTenant(fresh.db, uniquePlacesSeed);
    expect((await seedGuideFixtures(fresh.db, up, now)).written).toBe(guideFixtures.length);
    expect((await seedGuideFixtures(fresh.db, up, now)).written).toBe(0);
    expect(await listPublishedGuideEntries(fresh.db, up, { propertyId: "hov" })).toHaveLength(8);
    await fresh.close();
  });
});

describe("admin accounts", () => {
  it("finds users case-insensitively and resolves only live sessions of active users", async () => {
    const user = await createAdminUser(db, up, {
      email: "Redaktion@Example.com",
      passwordHash: await hashPassword("a-long-test-password"),
    });
    expect(user.email).toBe("redaktion@example.com");
    expect((await findAdminUserByEmail(db, " REDAKTION@example.com "))?.id).toBe(user.id);

    const tokenHash = hashSecret(generateSecret());
    await createAdminSession(db, up, {
      adminUserId: user.id,
      tokenHash,
      expiresAt: new Date(now.getTime() + 3600_000),
    });
    expect((await findAdminSessionByTokenHash(db, tokenHash, now))?.user.tenantId).toBe(
      "unique-places",
    );
    expect(
      await findAdminSessionByTokenHash(db, tokenHash, new Date(now.getTime() + 3600_000)),
    ).toBeUndefined();

    await db.execute(sql`UPDATE admin_users SET status = 'disabled' WHERE id = ${user.id}`);
    expect(await findAdminSessionByTokenHash(db, tokenHash, now)).toBeUndefined();
    await db.execute(sql`UPDATE admin_users SET status = 'active' WHERE id = ${user.id}`);
    await revokeAdminSession(db, tokenHash, now);
    expect(await findAdminSessionByTokenHash(db, tokenHash, now)).toBeUndefined();
  });

  it("rejects malformed e-mails and plaintext passwords", async () => {
    await expectConstraintViolation(
      db.execute(
        sql`INSERT INTO admin_users (tenant_id, email, password_hash) VALUES ('unique-places', 'a@b.de', 'plaintext')`,
      ),
      "admin_users_password_hash_format",
    );
    await expectConstraintViolation(
      db.execute(
        sql`INSERT INTO admin_users (tenant_id, email, password_hash) VALUES ('unique-places', 'Upper@Case.de', 'scrypt$x')`,
      ),
      "admin_users_email_format",
    );
  });
});
