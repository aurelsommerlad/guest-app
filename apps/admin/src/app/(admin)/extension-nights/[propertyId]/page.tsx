import type { Metadata } from "next";

import { ExtensionNightsView } from "../../../../features/operations/components/views";

export const metadata: Metadata = { title: "Verlängerungsnächte" };

type Props = { params: Promise<{ propertyId: string }> };

export default async function ExtensionNightsPropertyPage({ params }: Props) {
  const { propertyId } = await params;
  return <ExtensionNightsView viewProperty={propertyId} />;
}
