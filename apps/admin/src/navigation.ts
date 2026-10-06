/**
 * Admin information architecture: one registry for the sidebar, the property context and
 * the URLs. A new module (Aufenthalte, Inbox, Explore, Extras …) is one entry here plus its
 * route folder – shell, selector and links follow automatically. Only modules that exist
 * are listed; there are no placeholder pages. Empty groups are not rendered.
 *
 * URL convention (the URL is the source of truth for the property context):
 *   property modules  /{segment}               → "Alle Objekte"
 *                     /{segment}/{propertyId}… → one property
 *   tenant modules    /{segment}…              → not property-bound (e.g. Objekte, Team)
 */
import type { IconName } from "@up/ui";

export type NavigationGroupId =
  "overview" | "guests" | "communication" | "content" | "services" | "admin";

/** Long-term group order. `label: undefined` = no heading (Dashboard at the top). */
export const navigationGroups: readonly { id: NavigationGroupId; label?: string }[] = [
  { id: "overview" },
  { id: "guests", label: "Gäste" },
  { id: "communication", label: "Kommunikation" },
  { id: "content", label: "Inhalte" },
  { id: "services", label: "Services" },
  { id: "admin", label: "Verwaltung" },
];

export type AdminModule = {
  id: string;
  label: string;
  group: NavigationGroupId;
  /** First URL segment. */
  segment: string;
  icon: IconName;
  /**
   * property: works within the property context. `allProperties` says what "Alle Objekte"
   *           means: "aggregate" (module shows all properties, e.g. a future Inbox) or
   *           "choose" (module needs one property and asks for it, e.g. Guide).
   * tenant:   not property-bound; the selector only remembers the choice.
   */
  scope: { kind: "property"; allProperties: "aggregate" | "choose" } | { kind: "tenant" };
  /** Second URL segments that are pages of the module, not property ids (e.g. "new"). */
  reservedSegments?: readonly string[];
};

export const adminModules: readonly AdminModule[] = [
  {
    id: "guide",
    label: "Guide",
    group: "content",
    segment: "guide",
    icon: "book-open",
    scope: { kind: "property", allProperties: "choose" },
  },
  {
    id: "explore",
    label: "Explore",
    group: "content",
    segment: "explore",
    icon: "compass",
    // Places belong to the tenant; "Alle Objekte" shows all of them with their assignment.
    scope: { kind: "property", allProperties: "aggregate" },
    reservedSegments: ["places", "new"],
  },
  {
    id: "properties",
    label: "Objekte",
    group: "admin",
    segment: "properties",
    icon: "home",
    scope: { kind: "tenant" },
  },
];

export type ResolvedGroup = { id: NavigationGroupId; label?: string; modules: AdminModule[] };

/** Groups in long-term order, each with its existing modules; empty groups are left out. */
export function visibleNavigation(modules: readonly AdminModule[] = adminModules): ResolvedGroup[] {
  return navigationGroups
    .map((group) => ({ ...group, modules: modules.filter((module) => module.group === group.id) }))
    .filter((group) => group.modules.length > 0);
}

export type AdminLocation = {
  module: AdminModule | undefined;
  /** Property id from the URL (only for property modules; not yet validated). */
  propertyId: string | undefined;
};

export function parseAdminPath(
  pathname: string,
  modules: readonly AdminModule[] = adminModules,
): AdminLocation {
  const [segment, second] = pathname.split("/").filter(Boolean);
  const found = modules.find((candidate) => candidate.segment === segment);
  return {
    module: found,
    propertyId:
      found?.scope.kind === "property" && second && !found.reservedSegments?.includes(second)
        ? decodeURIComponent(second)
        : undefined,
  };
}

/**
 * The active property: from the URL on property modules ("Alle Objekte" at the module
 * root), otherwise the remembered choice. Ids that are not among the tenant's properties
 * (unknown, other tenant, manipulated cookie) never count.
 */
export function activePropertyId(
  location: AdminLocation,
  knownPropertyIds: readonly string[],
  rememberedPropertyId: string | null,
): string | null {
  const known = (id: string | null | undefined) =>
    id !== null && id !== undefined && knownPropertyIds.includes(id) ? id : null;
  if (location.module?.scope.kind === "property") return known(location.propertyId);
  return known(rememberedPropertyId);
}

/** Link into a module, carrying the property context where the module uses it. */
export function moduleHref(module: AdminModule, propertyId: string | null): string {
  if (module.scope.kind === "property" && propertyId) {
    return `/${module.segment}/${encodeURIComponent(propertyId)}`;
  }
  return `/${module.segment}`;
}

/**
 * Where choosing a property in the selector leads. On a property module: the same module
 * for the new property (deeper pages such as a topic belong to the old property, so they
 * are left). Elsewhere: stay on the page.
 */
export function selectorHref(pathname: string, propertyId: string | null): string {
  const { module } = parseAdminPath(pathname);
  return module?.scope.kind === "property" ? moduleHref(module, propertyId) : pathname;
}

export function isModuleActive(module: AdminModule, pathname: string): boolean {
  return parseAdminPath(pathname).module?.id === module.id;
}

/** Remembered property choice (convenience only – never used for authorization). */
export const PROPERTY_COOKIE = "up_admin_property";

/** Old URLs (Phase 9) keep working. */
export const legacyRedirects = [
  {
    source: "/properties/:propertyId/guide/:path*",
    destination: "/guide/:propertyId/:path*",
    permanent: false,
  },
] as const;
