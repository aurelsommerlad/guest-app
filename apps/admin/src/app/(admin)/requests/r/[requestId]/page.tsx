import type { Metadata } from "next";

import { RequestDetailView } from "../../../../../features/operations/components/views";

export const metadata: Metadata = { title: "Anfragen" };

type Props = {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
};

export default async function Page({ params, searchParams }: Props) {
  const [{ requestId }, { notice, error }] = await Promise.all([params, searchParams]);
  return (
    <RequestDetailView
      requestId={requestId}
      {...(notice ? { notice } : {})}
      {...(error ? { error } : {})}
    />
  );
}
