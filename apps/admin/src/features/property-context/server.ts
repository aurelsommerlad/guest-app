import "server-only";

import { listPropertiesForTenant } from "@up/db";
import { cookies } from "next/headers";
import { cache } from "react";

import { visibleProperties } from "../auth/authorization";
import { requireAdmin } from "../auth/server";
import { PROPERTY_COOKIE } from "../../navigation";
import { getDatabase } from "../../server/database";
import { type ContextProperty, rememberedProperty } from "./property-context";

/** The tenant's properties the signed-in admin may access (once per request). */
export const getTenantProperties = cache(async (): Promise<ContextProperty[]> => {
  const admin = await requireAdmin();
  const properties = await listPropertiesForTenant(getDatabase(), { tenantId: admin.tenantId });
  return visibleProperties(admin, properties).map((property) => ({
    id: property.id,
    displayName: property.displayName,
    spokenName: property.spokenName,
    locationName: property.locationName,
  }));
});

/** The remembered property, validated against the tenant's properties. */
export async function getRememberedPropertyId(): Promise<string | null> {
  const [properties, store] = await Promise.all([getTenantProperties(), cookies()]);
  return rememberedProperty(store.get(PROPERTY_COOKIE)?.value, properties);
}
