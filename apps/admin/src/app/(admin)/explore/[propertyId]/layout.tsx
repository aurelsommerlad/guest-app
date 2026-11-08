import { getPropertyById } from "@up/db";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { requirePermission } from "../../../../features/auth/server";
import { getDatabase } from "../../../../server/database";

type Props = { children: ReactNode; params: Promise<{ propertyId: string }> };

/** Guard for every property view of EXPLORE: the property must belong to the admin's tenant
 * and be within the admin's property access. */
export default async function ExplorePropertyLayout({ children, params }: Props) {
  const { propertyId } = await params;
  const admin = await requirePermission("content.read", { propertyId });
  const property = await getPropertyById(getDatabase(), { tenantId: admin.tenantId }, propertyId);
  if (!property) notFound();
  return children;
}
