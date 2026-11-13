import type { Metadata } from "next";

import { type InboxSearch, InboxScreen } from "../../../features/inbox/components/InboxScreen";

export const metadata: Metadata = { title: "Posteingang" };

export default async function Page({ searchParams }: { searchParams: Promise<InboxSearch> }) {
  return <InboxScreen search={await searchParams} />;
}
