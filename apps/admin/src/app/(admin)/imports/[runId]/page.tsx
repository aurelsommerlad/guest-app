import type { Metadata } from "next";

import { ImportDetailView } from "../../../../features/operations/components/views";

export const metadata: Metadata = { title: "Datenimport" };

type Props = { params: Promise<{ runId: string }> };

export default async function ImportRunPage({ params }: Props) {
  const { runId } = await params;
  return <ImportDetailView runId={runId} />;
}
