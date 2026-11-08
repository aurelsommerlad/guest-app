import type { Metadata } from "next";

import { requirePermission } from "../../../../features/auth/server";
import { CatalogListView } from "../../../../features/services/components/views";

export const metadata: Metadata = { title: "Servicekatalog" };

type Props = { params: Promise<{ propertyId: string }> };

export default async function ServicesPropertyPage({ params }: Props) {
  const { propertyId } = await params;
  await requirePermission("catalog.read", { propertyId });
  return <CatalogListView viewProperty={propertyId} />;
}
