import type { Metadata } from "next";

import { ExtensionDetailView } from "../../../../../features/operations/components/views";

export const metadata: Metadata = { title: "Verlängerungen" };

type Props = { params: Promise<{ extensionId: string }> };

export default async function Page({ params }: Props) {
  const { extensionId } = await params;
  return <ExtensionDetailView extensionId={extensionId} />;
}
