import type { Metadata } from "next";

import { RequestsView } from "../../../features/operations/components/views";

export const metadata: Metadata = { title: "Anfragen" };

type Props = { searchParams: Promise<{ status?: string }> };

export default async function Page({ searchParams }: Props) {
  const { status } = await searchParams;
  return <RequestsView viewProperty={null} {...(status ? { status } : {})} />;
}
