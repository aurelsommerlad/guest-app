import type { Metadata } from "next";

import {
  type InboxSearch,
  InboxScreen,
} from "../../../../../features/inbox/components/InboxScreen";

export const metadata: Metadata = { title: "Unterhaltung" };

type Props = { params: Promise<{ conversationId: string }>; searchParams: Promise<InboxSearch> };

export default async function Page({ params, searchParams }: Props) {
  const [{ conversationId }, search] = await Promise.all([params, searchParams]);
  return <InboxScreen conversationId={conversationId} search={search} />;
}
