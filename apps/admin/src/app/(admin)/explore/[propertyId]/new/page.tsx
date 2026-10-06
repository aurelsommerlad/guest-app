import type { Metadata } from "next";

import { NewPlaceView } from "../../../../../features/explore/components/views";

export const metadata: Metadata = { title: "Neue Empfehlung" };

export default async function NewPropertyPlacePage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  return <NewPlaceView viewProperty={propertyId} />;
}
