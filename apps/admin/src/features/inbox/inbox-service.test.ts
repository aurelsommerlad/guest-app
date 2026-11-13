import { describe, expect, it } from "vitest";

import { type AdminContext } from "../auth/admin-auth-service";
import { inboxScopeFor, parseInboxFilter } from "./inbox-service";
import { type PushDeps, sendTestNotification, userAgentFamily } from "./push-service";

const base = {
  adminUserId: "11111111-1111-4111-8111-111111111111",
  tenantId: "unique-places",
  email: "x@example.test",
} as const;
const ctx = (extra: Partial<AdminContext>): AdminContext => ({
  ...base,
  role: "owner",
  propertyScope: "all",
  propertyIds: [],
  ...extra,
});

describe("inbox scope (RLS settings) from the admin context", () => {
  it("gives owners all properties and notes", () => {
    expect(inboxScopeFor(ctx({}))).toMatchObject({
      allProperties: true,
      propertyIds: [],
      canReadNotes: true,
      actor: "staff",
    });
  });

  it("limits managers to their properties", () => {
    expect(
      inboxScopeFor(ctx({ role: "manager", propertyScope: "selected", propertyIds: ["hov"] })),
    ).toMatchObject({ allProperties: false, propertyIds: ["hov"], canReadNotes: true });
  });

  it("gives viewers no inbox without a grant and no notes with one", () => {
    expect(inboxScopeFor(ctx({ role: "viewer" }))).toBeUndefined();
    expect(inboxScopeFor(ctx({ role: "viewer", grants: ["inbox.read"] }))).toMatchObject({
      canReadNotes: false,
    });
  });
});

describe("filters from the URL", () => {
  it("accepts known values and ignores everything else", () => {
    expect(
      parseInboxFilter({ channel: "airbnb", status: "open", unread: "1", assignee: "me" }),
    ).toEqual({ channel: "airbnb", status: "open", unreadOnly: true, assignee: "me" });
    expect(
      parseInboxFilter({ channel: "x'; drop", status: "deleted", unread: "yes", assignee: "all" }),
    ).toEqual({});
  });
});

describe("push", () => {
  it("never sends a test notification while push is off", async () => {
    const deps = { db: undefined as never, mode: "off", now: () => new Date() } satisfies PushDeps;
    expect(await sendTestNotification(deps, ctx({}), "x")).toMatchObject({ ok: false });
  });

  it("stores only a coarse device family", () => {
    expect(
      userAgentFamily(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("iOS · Safari");
    expect(userAgentFamily("Mozilla/5.0 (Windows NT 10.0) Chrome/130")).toBe("Windows · Chrome");
  });
});
