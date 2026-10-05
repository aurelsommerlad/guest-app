/**
 * Admin navigation registry. Later areas (Explore, Inbox, Check-in, Access, Integrations …)
 * are added here as entries – the shell and the property pages render whatever is listed.
 * Only what exists is listed; there are no placeholder pages.
 */
export type NavigationItem = { id: string; label: string; href: string };

/** Main areas in the sidebar. */
export const mainNavigation: readonly NavigationItem[] = [
  { id: "properties", label: "Objekte", href: "/properties" },
];

/** Modules per property (tabs on the property pages). */
export const propertyModules: readonly {
  id: string;
  label: string;
  href: (propertyId: string) => string;
}[] = [{ id: "guide", label: "Guide", href: (propertyId) => `/properties/${propertyId}/guide` }];
