import { describe, expect, it } from "vitest";

import { type GuideSection } from "./guide-model";
import { type GuideContext, selectGuideSections } from "./select-guide-sections";

function section(overrides: Partial<GuideSection> & Pick<GuideSection, "id">): GuideSection {
  return {
    tenantId: "unique-places",
    key: overrides.id,
    scope: { level: "property", propertyId: "hov" },
    status: "published",
    slug: { de: overrides.id },
    title: { de: overrides.id },
    shortDescription: { de: "" },
    icon: "info",
    sortOrder: 0,
    blocks: [],
    ...overrides,
  };
}

const context: GuideContext = {
  tenantId: "unique-places",
  propertyId: "hov",
  unitId: "ros",
  now: new Date("2026-08-29T12:00:00+02:00"),
  access: "reservation",
  stay: { checkInAt: "2026-08-27T16:00:00+02:00", checkOutAt: "2026-08-31T10:00:00+02:00" },
};

describe("selectGuideSections", () => {
  it("orders by sortOrder", () => {
    const result = selectGuideSections(
      [section({ id: "b", sortOrder: 2 }), section({ id: "a", sortOrder: 1 })],
      context,
    );
    expect(result.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("applies tenant, property and unit scopes", () => {
    const result = selectGuideSections(
      [
        section({ id: "tenant-wide", scope: { level: "tenant" } }),
        section({ id: "hov", scope: { level: "property", propertyId: "hov" } }),
        section({ id: "alpila", scope: { level: "property", propertyId: "alpila" } }),
        section({ id: "ros-only", scope: { level: "unit", propertyId: "hov", unitId: "ros" } }),
        section({ id: "igl-only", scope: { level: "unit", propertyId: "hov", unitId: "igl" } }),
      ],
      context,
    );
    expect(result.map((s) => s.id).sort()).toEqual(["hov", "ros-only", "tenant-wide"]);
  });

  it("never returns another tenant's or unpublished content", () => {
    const result = selectGuideSections(
      [
        section({ id: "other", tenantId: "other-tenant" }),
        section({ id: "draft", status: "draft" }),
      ],
      context,
    );
    expect(result).toEqual([]);
  });

  it("respects section and block visibility", () => {
    const result = selectGuideSections(
      [
        section({
          id: "later",
          visibility: { from: { type: "stay", anchor: "check-out", offsetMinutes: -1440 } },
        }),
        section({
          id: "arrival",
          blocks: [
            { id: "always", type: "paragraph", text: { de: "Hallo" } },
            {
              id: "door-code",
              type: "paragraph",
              text: { de: "Code" },
              visibility: {
                from: { type: "stay", anchor: "check-in" },
                until: { type: "stay", anchor: "check-in", offsetMinutes: 60 },
              },
            },
          ],
        }),
      ],
      context,
    );
    expect(result.map((s) => s.id)).toEqual(["arrival"]);
    expect(result[0]?.blocks.map((b) => b.id)).toEqual(["always"]);
  });
});
