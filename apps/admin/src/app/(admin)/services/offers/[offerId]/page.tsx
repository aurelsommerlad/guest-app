import type { Metadata } from "next";

import { OfferView } from "../../../../../features/services/components/views";

export const metadata: Metadata = { title: "Service" };

type Props = { params: Promise<{ offerId: string }>; searchParams: Promise<{ error?: string }> };

export default async function OfferPage({ params, searchParams }: Props) {
  const [{ offerId }, { error }] = await Promise.all([params, searchParams]);
  return <OfferView offerId={offerId} {...(error ? { error } : {})} />;
}
