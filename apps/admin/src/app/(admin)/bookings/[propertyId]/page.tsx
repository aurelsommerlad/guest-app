import type { Metadata } from "next";

import { BookingsView } from "../../../../features/operations/components/views";

export const metadata: Metadata = { title: "Bestellungen" };

type Props = { params: Promise<{ propertyId: string }> };

export default async function Page({ params }: Props) {
  const { propertyId } = await params;
  return <BookingsView viewProperty={propertyId} />;
}
