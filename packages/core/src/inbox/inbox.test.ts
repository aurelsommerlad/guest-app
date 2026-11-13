import { describe, expect, it } from "vitest";

import { type AdminPrincipal, can } from "../admin/permissions";
import { isUnread, statusAfterInbound, statusAfterReply } from "./inbox-model";
import {
  classifyPushResponse,
  inboxConversationPath,
  isValidPushEndpoint,
  messageNotification,
} from "./push";

const p = (role: AdminPrincipal["role"], extra: Partial<AdminPrincipal> = {}): AdminPrincipal => ({
  role,
  propertyScope: "all",
  propertyIds: [],
  ...extra,
});

describe("inbox permissions (ADR 0023)", () => {
  it("owner and admin have full inbox access, manager everything but channel management", () => {
    for (const role of ["owner", "admin"] as const) {
      for (const perm of [
        "inbox.read",
        "inbox.reply",
        "inbox.notes",
        "inbox.assign",
        "inbox.manage",
      ] as const)
        expect(can(p(role), perm, perm === "inbox.manage" ? {} : { propertyId: "hov" })).toBe(true);
    }
    expect(can(p("manager"), "inbox.reply", { propertyId: "hov" })).toBe(true);
    expect(can(p("manager"), "inbox.manage")).toBe(false);
  });

  it("managers only see their assigned properties", () => {
    const hov = p("manager", { propertyScope: "selected", propertyIds: ["hov"] });
    expect(can(hov, "inbox.read", { propertyId: "hov" })).toBe(true);
    expect(can(hov, "inbox.read", { propertyId: "test-run" })).toBe(false);
    expect(can(hov, "inbox.reply", { propertyId: "test-run" })).toBe(false);
  });

  it("viewers read messages only with an explicit grant and never notes or replies", () => {
    expect(can(p("viewer"), "inbox.read", { propertyId: "hov" })).toBe(false);
    const granted = p("viewer", { grants: ["inbox.read"] });
    expect(can(granted, "inbox.read", { propertyId: "hov" })).toBe(true);
    expect(can(granted, "inbox.notes", { propertyId: "hov" })).toBe(false);
    expect(can(granted, "inbox.reply", { propertyId: "hov" })).toBe(false);
  });

  it("only grantable permissions take effect as grants", () => {
    const sneaky = p("viewer", { grants: ["inbox.reply", "inbox.notes", "users.manage"] });
    expect(can(sneaky, "inbox.reply", { propertyId: "hov" })).toBe(false);
    expect(can(sneaky, "inbox.notes", { propertyId: "hov" })).toBe(false);
    expect(can(sneaky, "users.manage")).toBe(false);
  });

  it("a grant does not widen property access", () => {
    const v = p("viewer", {
      propertyScope: "selected",
      propertyIds: ["hov"],
      grants: ["inbox.read"],
    });
    expect(can(v, "inbox.read", { propertyId: "test-run" })).toBe(false);
  });
});

describe("conversation rules", () => {
  it("an inbound message opens the conversation, a reply hands it to the guest", () => {
    expect(statusAfterInbound()).toBe("open");
    expect(statusAfterReply("open")).toBe("pending");
    expect(statusAfterReply("done")).toBe("done");
  });

  it("unread means an inbound message newer than the read mark", () => {
    const t = new Date("2026-11-13T10:00:00Z");
    expect(isUnread(null, null)).toBe(false);
    expect(isUnread(t, null)).toBe(true);
    expect(isUnread(t, new Date("2026-11-13T10:00:01Z"))).toBe(false);
    expect(isUnread(new Date("2026-11-13T10:00:02Z"), new Date("2026-11-13T10:00:01Z"))).toBe(true);
  });
});

describe("push rules", () => {
  it("accepts only https endpoints of bounded length", () => {
    expect(isValidPushEndpoint("https://web.push.apple.com/QGZ")).toBe(true);
    expect(isValidPushEndpoint("http://web.push.apple.com/x")).toBe(false);
    expect(isValidPushEndpoint("javascript:alert(1)")).toBe(false);
    expect(isValidPushEndpoint(`https://x.example/${"a".repeat(1001)}`)).toBe(false);
  });

  it("classifies push service answers", () => {
    expect(classifyPushResponse(201).status).toBe("sent");
    expect(classifyPushResponse(410).status).toBe("expired");
    expect(classifyPushResponse(404).status).toBe("expired");
    expect(classifyPushResponse(429)).toMatchObject({ status: "failed", retryable: true });
    expect(classifyPushResponse(503)).toMatchObject({ status: "failed", retryable: true });
    expect(classifyPushResponse(413)).toMatchObject({ status: "failed", retryable: false });
  });

  it("message notifications carry no content and deep link to the conversation", () => {
    const n = messageNotification({
      conversationId: "c-1",
      channelLabel: "Booking.com",
      propertyName: "Haus",
    });
    expect(n).toEqual({
      title: "Neue Gästenachricht",
      body: "Booking.com · Haus",
      url: inboxConversationPath("c-1"),
      tag: "conversation:c-1",
    });
    expect(n.url).toBe("/inbox/c/c-1");
  });
});
