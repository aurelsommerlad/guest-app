import type { Metadata } from "next";

import { type InboxSearch, InboxScreen } from "../../../../features/inbox/components/InboxScreen";

export const metadata: Metadata = { title: "Posteingang" };

type Props = { params: Promise<{ propertyId: string }>; searchParams: Promise<InboxSearch> };

export default async function Page({ params, searchParams }: Props) {
  const [{ propertyId }, search] = await Promise.all([params, searchParams]);
  return <InboxScreen propertyId={propertyId} search={search} />;
}
