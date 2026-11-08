import type { Metadata } from "next";

import { NotificationsView } from "../../../features/notifications/components/NotificationsView";

export const metadata: Metadata = { title: "Benachrichtigungen" };

type Props = { searchParams: Promise<{ notice?: string; error?: string }> };

export default async function Page({ searchParams }: Props) {
  const { notice, error } = await searchParams;
  return <NotificationsView {...(notice ? { notice } : {})} {...(error ? { error } : {})} />;
}
