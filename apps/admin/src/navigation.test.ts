import { describe, expect, it } from "vitest";

import {
  activePropertyId,
  type AdminModule,
  adminModules,
  isModuleActive,
  legacyRedirects,
  moduleHref,
  navigationGroups,
  parseAdminPath,
  selectorHref,
  visibleNavigation,
} from "./navigation";

const known = ["hov", "huesle", "laeke", "alpila"];
const guide = adminModules.find((module) => module.id === "guide") as AdminModule;
const properties = adminModules.find((module) => module.id === "properties") as AdminModule;

describe("admin navigation registry", () => {
  it("lists only existing modules, in the long-term group order, without empty groups", () => {
    const groups = visibleNavigation();
    expect(groups.map((group) => group.label)).toEqual(["Inhalte", "Verwaltung"]);
    expect(groups.flatMap((group) => group.modules.map((module) => module.label))).toEqual([
      "Guide",
      "Objekte",
    ]);
    expect(navigationGroups.map((group) => group.label)).toEqual([
      undefined,
      "Gäste",
      "Kommunikation",
      "Inhalte",
      "Services",
      "Verwaltung",
    ]);
  });

  it("places future modules into their group without changing the shell", () => {
    const inbox: AdminModule = {
      id: "inbox",
      label: "Inbox",
      group: "communication",
      segment: "inbox",
      icon: "mail",
      scope: { kind: "property", allProperties: "aggregate" },
    };
    const groups = visibleNavigation([...adminModules, inbox]);
    expect(groups.map((group) => group.label)).toEqual(["Kommunikation", "Inhalte", "Verwaltung"]);
    expect(moduleHref(inbox, null)).toBe("/inbox");
    expect(moduleHref(inbox, "hov")).toBe("/inbox/hov");
  });

  it("marks the module of the current URL as active, including deep pages", () => {
    expect(isModuleActive(guide, "/guide")).toBe(true);
    expect(isModuleActive(guide, "/guide/hov/123e4567-e89b-42d3-a456-426614174000")).toBe(true);
    expect(isModuleActive(guide, "/properties")).toBe(false);
    expect(isModuleActive(properties, "/properties")).toBe(true);
    expect(isModuleActive(guide, "/guidebook")).toBe(false);
  });
});

describe("property context from the URL", () => {
  it("reads the property from property-module URLs only", () => {
    expect(parseAdminPath("/guide/hov/new")).toEqual({ module: guide, propertyId: "hov" });
    expect(parseAdminPath("/guide")).toEqual({ module: guide, propertyId: undefined });
    expect(parseAdminPath("/properties/hov")).toEqual({
      module: properties,
      propertyId: undefined,
    });
    expect(parseAdminPath("/unknown/hov")).toEqual({ module: undefined, propertyId: undefined });
  });

  it("uses the URL on property modules – the module root means Alle Objekte", () => {
    expect(activePropertyId(parseAdminPath("/guide/laeke"), known, "hov")).toBe("laeke");
    expect(activePropertyId(parseAdminPath("/guide"), known, "hov")).toBeNull();
  });

  it("uses the remembered choice where the URL carries no property", () => {
    expect(activePropertyId(parseAdminPath("/properties"), known, "hov")).toBe("hov");
    expect(activePropertyId(parseAdminPath("/properties"), known, null)).toBeNull();
  });

  it("never accepts unknown or other tenants' property ids", () => {
    expect(activePropertyId(parseAdminPath("/guide/other-hov"), known, "hov")).toBeNull();
    expect(activePropertyId(parseAdminPath("/properties"), known, "other-hov")).toBeNull();
    expect(activePropertyId(parseAdminPath("/guide/hov"), [], null)).toBeNull();
  });
});

describe("selector and sidebar links", () => {
  it("switches the property within a property module and leaves deep pages of the old one", () => {
    expect(selectorHref("/guide/hov", "laeke")).toBe("/guide/laeke");
    expect(selectorHref("/guide/hov/123e4567-e89b-42d3-a456-426614174000", "laeke")).toBe(
      "/guide/laeke",
    );
    expect(selectorHref("/guide/hov/new", null)).toBe("/guide");
    expect(selectorHref("/guide", "alpila")).toBe("/guide/alpila");
  });

  it("stays on pages that are not property-bound", () => {
    expect(selectorHref("/properties", "hov")).toBe("/properties");
    expect(selectorHref("/properties", null)).toBe("/properties");
  });

  it("carries the active property into property modules only", () => {
    expect(moduleHref(guide, "hov")).toBe("/guide/hov");
    expect(moduleHref(guide, null)).toBe("/guide");
    expect(moduleHref(properties, "hov")).toBe("/properties");
  });

  it("keeps old Phase-9 URLs working", () => {
    expect(legacyRedirects).toEqual([
      {
        source: "/properties/:propertyId/guide/:path*",
        destination: "/guide/:propertyId/:path*",
        permanent: false,
      },
    ]);
  });
});
