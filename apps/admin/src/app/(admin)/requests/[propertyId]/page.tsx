import type { Metadata } from "next";

import { RequestsView } from "../../../../features/operations/components/views";

export const metadata: Metadata = { title: "Anfragen" };

type Props = {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ status?: string }>;
};

export default async function Page({ params, searchParams }: Props) {
  const [{ propertyId }, { status }] = await Promise.all([params, searchParams]);
  return <RequestsView viewProperty={propertyId} {...(status ? { status } : {})} />;
}
