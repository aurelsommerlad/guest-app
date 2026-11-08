import type { Metadata } from "next";

import { ExtensionsView } from "../../../../features/operations/components/views";

export const metadata: Metadata = { title: "Verlängerungen" };

type Props = { params: Promise<{ propertyId: string }> };

export default async function Page({ params }: Props) {
  const { propertyId } = await params;
  return <ExtensionsView viewProperty={propertyId} />;
}
