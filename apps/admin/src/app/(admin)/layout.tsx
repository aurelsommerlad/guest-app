import type { ReactNode } from "react";

import { AdminShell } from "../../components/AdminShell";
import { requireAdmin } from "../../features/auth/server";
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
  return (
    <AdminShell
      email={admin.email}
      properties={properties}
      rememberedPropertyId={rememberedPropertyId}
    >
      {children}
    </AdminShell>
  );
}
