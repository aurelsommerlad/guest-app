/**
 * Tenant → Property → Unit: the platform's master data (ADR 0010).
 *
 * Ids are our own, stable and immutable – never PMS ids. Slugs are for URLs and may
 * change; references (content scopes, mappings, sessions) always use ids.
 */

/** Lowercase id/slug: starts with a letter or digit, then letters, digits or hyphens (max 64). */
export const ENTITY_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isEntityKey(value: string): boolean {
  return ENTITY_KEY_PATTERN.test(value);
}

/** Every tenant-related read requires this context. There is no implicit default tenant. */
export type TenantContext = { readonly tenantId: string };

export type Tenant = {
  id: string;
  slug: string;
  name: string;
};

export type Property = {
  id: string;
  tenantId: string;
  slug: string;
  /** Branded display name exactly as written, e.g. "HØV". */
  displayName: string;
  /** Pronounceable name for screen readers, e.g. "Höv". */
  spokenName: string;
  locationName: string;
  /** IANA time zone, e.g. "Europe/Berlin". */
  timezone: string;
  isActive: boolean;
};

export type Unit = {
  id: string;
  tenantId: string;
  propertyId: string;
  slug: string;
  displayName: string;
  isActive: boolean;
};

/** External systems we map ids for. Extended per integration (e.g. "nuki") when it is built. */
export const EXTERNAL_PROVIDERS = ["apaleo"] as const;
export type ExternalProvider = (typeof EXTERNAL_PROVIDERS)[number];

/** Internal entities that can carry an external id. */
export const EXTERNAL_ENTITY_TYPES = ["property", "unit"] as const;
export type ExternalEntityType = (typeof EXTERNAL_ENTITY_TYPES)[number];

export function isExternalProvider(value: string): value is ExternalProvider {
  return (EXTERNAL_PROVIDERS as readonly string[]).includes(value);
}

export function isExternalEntityType(value: string): value is ExternalEntityType {
  return (EXTERNAL_ENTITY_TYPES as readonly string[]).includes(value);
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
