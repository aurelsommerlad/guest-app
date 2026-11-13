import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database } from "../client";
import { seedTenant } from "../seed/seed-tenant";
import { uniquePlacesSeed } from "../seed/unique-places";
import { createTestDatabase, type TestDatabase } from "../testing/test-database";
import { createAdminUser } from "./admin-repository";
import { listAdminAuditEvents } from "./audit-repository";
import {
  addInternalNote,
  assignConversation,
  deliverSimulatedJobs,
  ensureSimulatedChannelAccount,
  getConversationDetail,
  getOwnPushKeys,
  inboxChangeMarker,
  type InboxScope,
  listAdminUserGrants,
  listConversations,
  listOwnPushDevices,
  markConversationRead,
  queueReply,
  recordInboundMessage,
  recordPushDelivery,
  savePushSubscription,
  setAdminUserGrant,
  setConversationStatus,
  systemInboxScope,
  withInboxScope,
} from "./inbox-repository";

const up = { tenantId: "unique-places" };

function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current && typeof current === "object") {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
const HASH = "scrypt$test";

let db: Database;
let client: TestDatabase["client"];
let close: () => Promise<void>;
let account: string;
let otherAccount: string;
let ownerId: string;
let managerId: string;
let viewerId: string;
let otherTenantAdminId: string;

const owner = (): InboxScope => ({
  tenantId: "unique-places",
  actor: "staff",
  adminUserId: ownerId,
  allProperties: true,
  propertyIds: [],
  canReadNotes: true,
});
const hovManager = (): InboxScope => ({
  tenantId: "unique-places",
  actor: "staff",
  adminUserId: managerId,
  allProperties: false,
  propertyIds: ["hov"],
  canReadNotes: true,
});
const grantedViewer = (): InboxScope => ({
  tenantId: "unique-places",
  actor: "staff",
  adminUserId: viewerId,
  allProperties: true,
  propertyIds: [],
  canReadNotes: false,
});
const system = () => systemInboxScope("unique-places");

let seq = 0;
async function inbound(
  propertyId: string | null,
  overrides: Partial<Parameters<typeof recordInboundMessage>[2]> = {},
) {
  seq += 1;
  return recordInboundMessage(db, system(), {
    channelAccountId: account,
    propertyId,
    channel: "booking_com",
    kind: "reservation",
    externalThreadId: `thread-${String(seq)}`,
    title: `Gast ${String(seq)}`,
    guestName: "Anna",
    externalMessageId: `msg-${String(seq)}`,
    text: "Hallo, wann können wir einchecken?",
    sentAt: new Date(Date.UTC(2026, 10, 13, 8, seq)),
    ...overrides,
  });
}

beforeAll(async () => {
  ({ db, client, close } = await createTestDatabase());
  await seedTenant(db, uniquePlacesSeed);
  await client.query(
    `INSERT INTO tenants (id, slug, name) VALUES ('other-tenant', 'other-tenant', 'Other')`,
  );
  await client.query(
    `INSERT INTO properties (id, tenant_id, slug, display_name, spoken_name, location_name, timezone)
     VALUES ('elsewhere', 'other-tenant', 'elsewhere', 'Elsewhere', 'Elsewhere', 'X', 'Europe/Berlin')`,
  );
  account = await ensureSimulatedChannelAccount(db, up);
  otherAccount = await ensureSimulatedChannelAccount(db, { tenantId: "other-tenant" });
  ownerId = (
    await createAdminUser(db, up, { email: "o@x.test", passwordHash: HASH, role: "owner" })
  ).id;
  managerId = (
    await createAdminUser(db, up, { email: "m@x.test", passwordHash: HASH, role: "manager" })
  ).id;
  viewerId = (
    await createAdminUser(db, up, { email: "v@x.test", passwordHash: HASH, role: "viewer" })
  ).id;
  otherTenantAdminId = (
    await createAdminUser(
      db,
      { tenantId: "other-tenant" },
      { email: "a@other.test", passwordHash: HASH, role: "owner" },
    )
  ).id;
});

afterAll(async () => {
  await close();
});

describe("row level security (stay_inbox)", () => {
  it("never shows another tenant's conversations, even without a filter in the query", async () => {
    await recordInboundMessage(db, systemInboxScope("other-tenant"), {
      channelAccountId: otherAccount,
      propertyId: "elsewhere",
      channel: "airbnb",
      kind: "inquiry",
      externalThreadId: "foreign-thread",
      title: "Fremd",
      guestName: "X",
      externalMessageId: "foreign-1",
      text: "Geheim",
      sentAt: new Date(),
    });
    const rows = await withInboxScope(db, owner(), async (tx) =>
      tx.execute("select title from conversations"),
    );
    const titles = JSON.stringify(rows);
    expect(titles).not.toContain("Fremd");
    const raw = await client.query<{ n: number }>(
      "select count(*)::int n from conversations where tenant_id = 'other-tenant'",
    );
    expect(raw.rows[0]?.n).toBe(1); // exists – only hidden by RLS
  });

  it("rejects writing rows of another tenant", async () => {
    await expect(
      withInboxScope(db, owner(), (tx) =>
        tx.execute(
          `insert into conversations (tenant_id, property_id, channel_account_id, channel, title)
           values ('other-tenant', 'elsewhere', '${otherAccount}', 'airbnb', 'x')`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("limits managers to their properties (list, detail, reply)", async () => {
    const hov = await inbound("hov");
    const huesle = await inbound("huesle");
    const list = await listConversations(db, hovManager());
    expect(list.map((c) => c.id)).toContain(hov.conversationId);
    expect(list.map((c) => c.id)).not.toContain(huesle.conversationId);
    expect(await getConversationDetail(db, hovManager(), huesle.conversationId)).toBeUndefined();
    expect(
      await queueReply(db, hovManager(), {
        conversationId: huesle.conversationId,
        text: "Hallo",
        clientMessageId: randomUUID(),
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("shows conversations of unmapped channel properties only to all-property staff", async () => {
    const unmapped = await inbound(null, { kind: "inquiry" });
    expect((await listConversations(db, hovManager())).map((c) => c.id)).not.toContain(
      unmapped.conversationId,
    );
    expect((await listConversations(db, owner())).map((c) => c.id)).toContain(
      unmapped.conversationId,
    );
  });

  it("hides internal notes without inbox.notes – also in the database", async () => {
    const c = await inbound("hov");
    const note = await addInternalNote(db, owner(), {
      conversationId: c.conversationId,
      text: "Gast war letztes Jahr schon da.",
      clientMessageId: randomUUID(),
    });
    expect(note).toMatchObject({ ok: true });
    const forOwner = await getConversationDetail(db, owner(), c.conversationId);
    expect(forOwner?.messages.some((m) => m.direction === "internal")).toBe(true);
    const forViewer = await getConversationDetail(db, grantedViewer(), c.conversationId);
    expect(forViewer?.messages.some((m) => m.direction === "internal")).toBe(false);
    expect(forViewer?.messages.length).toBe(1);
    const raw = await withInboxScope(db, grantedViewer(), (tx) =>
      tx.execute("select id from conversation_messages where direction = 'internal'"),
    );
    expect(JSON.stringify(raw)).not.toContain(note.ok ? note.messageId : "x");
    expect(
      await addInternalNote(db, grantedViewer(), {
        conversationId: c.conversationId,
        text: "x",
        clientMessageId: randomUUID(),
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("gives the inbox role no access to other tables", async () => {
    const error = await withInboxScope(db, owner(), (tx) =>
      tx.execute("select email from admin_users"),
    ).catch((e: unknown) => e);
    expect(pgCode(error)).toBe("42501"); // insufficient_privilege
  });
});

describe("messages", () => {
  it("deduplicates inbound messages and reopens a done conversation", async () => {
    const first = await inbound("hov");
    const done = await setConversationStatus(db, owner(), {
      conversationId: first.conversationId,
      status: "done",
      expectedStatus: "open",
    });
    expect(done.ok).toBe(true);
    const duplicate = await recordInboundMessage(db, system(), {
      channelAccountId: account,
      propertyId: "hov",
      channel: "booking_com",
      kind: "reservation",
      externalThreadId: `thread-${String(seq)}`,
      title: "x",
      guestName: "Anna",
      externalMessageId: `msg-${String(seq)}`,
      text: "Hallo, wann können wir einchecken?",
      sentAt: new Date(),
    });
    expect(duplicate.created).toBe(false);
    const again = await recordInboundMessage(db, system(), {
      channelAccountId: account,
      propertyId: "hov",
      channel: "booking_com",
      kind: "reservation",
      externalThreadId: `thread-${String(seq)}`,
      title: "x",
      guestName: "Anna",
      externalMessageId: `msg-${String(seq)}-b`,
      text: "Noch eine Frage",
      sentAt: new Date(Date.UTC(2026, 10, 13, 12)),
    });
    expect(again).toMatchObject({ created: true, conversationId: first.conversationId });
    const after = await getConversationDetail(db, owner(), first.conversationId);
    expect(after?.conversation.status).toBe("open");
    expect(after?.messages.filter((m) => m.direction === "inbound")).toHaveLength(2);
  });

  it("queues a reply once per client message id and delivers it simulated", async () => {
    const c = await inbound("hov");
    const clientMessageId = randomUUID();
    const reply = await queueReply(db, owner(), {
      conversationId: c.conversationId,
      text: "Ab 16 Uhr – wir freuen uns auf Euch!",
      clientMessageId,
    });
    expect(reply).toMatchObject({ ok: true, duplicate: false });
    const repeat = await queueReply(db, owner(), {
      conversationId: c.conversationId,
      text: "Ab 16 Uhr – wir freuen uns auf Euch!",
      clientMessageId,
    });
    expect(repeat).toMatchObject({ ok: true, duplicate: true });
    let detail = await getConversationDetail(db, owner(), c.conversationId);
    const outbound = detail?.messages.filter((m) => m.direction === "outbound") ?? [];
    expect(outbound).toHaveLength(1);
    expect(outbound[0]?.deliveryStatus).toBe("queued");
    expect(detail?.conversation.status).toBe("pending");
    const jobs = await client.query<{ n: number }>(
      `select count(*)::int n from message_delivery_jobs where message_id = '${reply.ok ? reply.messageId : ""}'`,
    );
    expect(jobs.rows[0]?.n).toBe(1);
    await deliverSimulatedJobs(db, system());
    detail = await getConversationDetail(db, owner(), c.conversationId);
    expect(detail?.messages.find((m) => m.direction === "outbound")?.deliveryStatus).toBe("sent");
  });

  it("shows a simulated delivery failure", async () => {
    const c = await inbound("hov");
    await queueReply(db, owner(), {
      conversationId: c.conversationId,
      text: "Test [simuliert:fehler]",
      clientMessageId: randomUUID(),
    });
    await deliverSimulatedJobs(db, system());
    const detail = await getConversationDetail(db, owner(), c.conversationId);
    expect(detail?.messages.find((m) => m.direction === "outbound")).toMatchObject({
      deliveryStatus: "failed",
      deliveryErrorCode: "simulated_failure",
    });
    expect(detail?.events.some((e) => e.type === "message_failed")).toBe(true);
  });

  it("rejects empty and over-long replies", async () => {
    const c = await inbound("hov");
    for (const text of ["   ", "x".repeat(8001)])
      expect(
        await queueReply(db, owner(), {
          conversationId: c.conversationId,
          text,
          clientMessageId: randomUUID(),
        }),
      ).toEqual({ ok: false, reason: "invalid" });
  });

  it("accepts long replies up to the limit", async () => {
    const c = await inbound("hov");
    const text = "Liebe Gäste, ".repeat(600).slice(0, 7900);
    expect(
      await queueReply(db, owner(), {
        conversationId: c.conversationId,
        text,
        clientMessageId: randomUUID(),
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("status, assignment, unread", () => {
  it("guards status changes by the status the admin saw – replies do not block them", async () => {
    const c = await inbound("hov");
    await queueReply(db, owner(), {
      conversationId: c.conversationId,
      text: "Gern!",
      clientMessageId: randomUUID(),
    }); // → pending
    expect(
      await setConversationStatus(db, owner(), {
        conversationId: c.conversationId,
        status: "done",
        expectedStatus: "pending",
      }),
    ).toMatchObject({ ok: true });
    // A second admin still saw "pending" and wants to reopen: someone changed it meanwhile.
    expect(
      await setConversationStatus(db, hovManager(), {
        conversationId: c.conversationId,
        status: "open",
        expectedStatus: "pending",
      }),
    ).toEqual({ ok: false, reason: "conflict" });
  });

  it("assigns, records the event and never overwrites a colleague's assignment unseen", async () => {
    const c = await inbound("hov");
    const result = await assignConversation(db, owner(), {
      conversationId: c.conversationId,
      assigneeAdminUserId: managerId,
      expectedAssigneeAdminUserId: null,
    });
    expect(result.ok).toBe(true);
    const mine = await listConversations(db, hovManager(), { assignee: "me" });
    expect(mine.map((x) => x.id)).toContain(c.conversationId);
    const detail = await getConversationDetail(db, owner(), c.conversationId);
    expect(detail?.events.some((e) => e.type === "assigned")).toBe(true);
    expect(
      await assignConversation(db, owner(), {
        conversationId: c.conversationId,
        assigneeAdminUserId: ownerId,
        expectedAssigneeAdminUserId: null,
      }),
    ).toEqual({ ok: false, reason: "conflict" });
  });

  it("tracks unread per staff member", async () => {
    const c = await inbound("hov");
    expect((await listConversations(db, owner(), { unreadOnly: true })).map((x) => x.id)).toContain(
      c.conversationId,
    );
    await markConversationRead(db, owner(), { conversationId: c.conversationId });
    expect(
      (await listConversations(db, owner(), { unreadOnly: true })).map((x) => x.id),
    ).not.toContain(c.conversationId);
    // Still unread for the manager.
    expect(
      (await listConversations(db, hovManager(), { unreadOnly: true })).map((x) => x.id),
    ).toContain(c.conversationId);
    const marker = await inboxChangeMarker(db, hovManager());
    expect(marker.unread).toBeGreaterThan(0);
    expect(marker.latest).not.toBeNull();
  });

  it("links reservations n:m and lists related conversations", async () => {
    const reservation = {
      reservationProvider: "apaleo" as const,
      externalReservationId: "JTKQSYFX-1",
      linkMethod: "simulated" as const,
    };
    const a = await inbound("hov", { channel: "booking_com", reservation });
    const b = await inbound("hov", { channel: "stay_chat", reservation });
    const detail = await getConversationDetail(db, owner(), a.conversationId);
    expect(detail?.reservations[0]?.externalReservationId).toBe("JTKQSYFX-1");
    expect(detail?.related.map((r) => r.id)).toContain(b.conversationId);
  });

  it("keeps the conversation timeline append-only", async () => {
    await expect(client.query("update conversation_events set type = 'created'")).rejects.toThrow(
      /append-only/,
    );
    await expect(client.query("delete from conversation_events")).rejects.toThrow(/append-only/);
  });
});

describe("push devices", () => {
  const keys = (n: number) => ({
    endpoint: `https://web.push.apple.com/device-${String(n)}-${"x".repeat(20)}`,
    p256dh: `BPd${"A".repeat(60)}${String(n)}`,
    auth: `auth${"B".repeat(16)}`,
  });

  it("stores several devices per staff member and shows each one only its own", async () => {
    await savePushSubscription(db, owner(), { ...keys(1), deviceLabel: "iPhone" });
    await savePushSubscription(db, owner(), { ...keys(2), deviceLabel: "iPad" });
    await savePushSubscription(db, hovManager(), { ...keys(3), deviceLabel: "iPhone M" });
    expect((await listOwnPushDevices(db, owner())).map((d) => d.deviceLabel)).toEqual(
      expect.arrayContaining(["iPhone", "iPad"]),
    );
    const managerDevices = await listOwnPushDevices(db, hovManager());
    expect(managerDevices.map((d) => d.deviceLabel)).toEqual(["iPhone M"]);
    const ownerDevice = (await listOwnPushDevices(db, owner()))[0];
    expect(await getOwnPushKeys(db, hovManager(), ownerDevice?.id ?? "")).toBeUndefined();
  });

  it("moves a browser subscription to the staff member who registers it on the same device", async () => {
    const moved = await savePushSubscription(db, hovManager(), {
      ...keys(1),
      deviceLabel: "Geteilt",
    });
    expect(moved.id).toBeTruthy();
    expect((await listOwnPushDevices(db, owner())).map((d) => d.deviceLabel)).not.toContain(
      "Geteilt",
    );
    expect((await listOwnPushDevices(db, hovManager())).map((d) => d.deviceLabel)).toContain(
      "Geteilt",
    );
  });

  it("logs deliveries once per device and dedup key and revokes expired devices", async () => {
    const device = (await listOwnPushDevices(db, owner()))[0];
    if (!device) throw new Error("no device");
    const base = {
      subscriptionId: device.id,
      adminUserId: ownerId,
      kind: "test" as const,
      dedupKey: "test:1",
    };
    expect(
      await recordPushDelivery(db, owner(), { ...base, status: "sent", httpStatus: 201 }),
    ).toBe(true);
    expect(
      await recordPushDelivery(db, owner(), { ...base, status: "sent", httpStatus: 201 }),
    ).toBe(false);
    await recordPushDelivery(db, owner(), {
      ...base,
      dedupKey: "test:2",
      status: "expired",
      httpStatus: 410,
    });
    const after = (await listOwnPushDevices(db, owner())).find((d) => d.id === device.id);
    expect(after?.revokedReason).toBe("gone");
  });

  it("rejects malformed endpoints in the database", async () => {
    await expect(
      savePushSubscription(db, owner(), { ...keys(9), endpoint: "http://insecure.example/x" }),
    ).rejects.toThrow();
  });
});

describe("explicit grants", () => {
  it("grants and withdraws inbox.read with an audit trail", async () => {
    await setAdminUserGrant(db, up, {
      adminUserId: viewerId,
      permission: "inbox.read",
      granted: true,
      actorAdminId: ownerId,
    });
    expect(await listAdminUserGrants(db, up, viewerId)).toEqual(["inbox.read"]);
    await setAdminUserGrant(db, up, {
      adminUserId: viewerId,
      permission: "inbox.read",
      granted: false,
      actorAdminId: ownerId,
    });
    expect(await listAdminUserGrants(db, up, viewerId)).toEqual([]);
    const audit = await listAdminAuditEvents(db, up, { limit: 10 });
    expect(audit.map((e) => e.action)).toEqual(
      expect.arrayContaining(["user.grant_added", "user.grant_removed"]),
    );
  });

  it("allows only grantable permissions", async () => {
    await expect(
      client.query(
        `insert into admin_user_grants (tenant_id, admin_user_id, permission) values ('unique-places', '${viewerId}', 'inbox.reply')`,
      ),
    ).rejects.toThrow();
  });

  it("cannot grant to another tenant's admin", async () => {
    await expect(
      setAdminUserGrant(db, up, {
        adminUserId: otherTenantAdminId,
        permission: "inbox.read",
        granted: true,
        actorAdminId: ownerId,
      }),
    ).rejects.toThrow();
  });
});
