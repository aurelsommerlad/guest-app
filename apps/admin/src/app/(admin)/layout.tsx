import type { ReactNode } from "react";

import { countPendingOfferRequests } from "@up/db";

import { AdminShell } from "../../components/AdminShell";
import { isAllowed, visibleProperties } from "../../features/auth/authorization";
import { requireAdmin } from "../../features/auth/server";
import { allowedModuleIds } from "../../navigation";
import { getDatabase } from "../../server/database";
import {
  getRememberedPropertyId,
  getTenantProperties,
} from "../../features/property-context/server";

/** Everything below requires a valid admin session; the shell gets the tenant's properties. */
export default async function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  const admin = await requireAdmin();
  const [properties, rememberedPropertyId] = await Promise.all([
    getTenantProperties(),
    getRememberedPropertyId(),
  ]);
  const allowed = allowedModuleIds((permission) => isAllowed(admin, permission));
  // Open requests that can be decided here, limited to the admin's properties.
  const openRequests = allowed.includes("requests")
    ? await countPendingOfferRequests(
        getDatabase(),
        { tenantId: admin.tenantId },
        admin.propertyScope === "all"
          ? {}
          : { propertyIds: visibleProperties(admin, properties).map((p) => p.id) },
      )
    : 0;
  return (
    <AdminShell
      email={admin.email}
      properties={properties}
      rememberedPropertyId={rememberedPropertyId}
      navigation={{ allowedModuleIds: allowed, badges: { requests: openRequests } }}
    >
      {children}
    </AdminShell>
  );
}
