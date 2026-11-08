import type { Metadata } from "next";

import { requirePermission } from "../../../../../../features/auth/server";
import { PropertyConfigView } from "../../../../../../features/services/components/views";

export const metadata: Metadata = { title: "Service an einem Objekt" };

type Props = { params: Promise<{ offerId: string; propertyId: string }> };

export default async function OfferPropertyPage({ params }: Props) {
  const { offerId, propertyId } = await params;
  await requirePermission("catalog.read", { propertyId });
  return <PropertyConfigView offerId={offerId} propertyId={propertyId} />;
}
