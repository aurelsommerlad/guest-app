import type { Metadata } from "next";

import { ShadowView } from "../../../../features/shadow/components/ShadowView";

export const metadata: Metadata = { title: "Schattenbetrieb" };

type Props = {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ reservation?: string }>;
};

export default async function Page({ params, searchParams }: Props) {
  const [{ propertyId }, { reservation }] = await Promise.all([params, searchParams]);
  return (
    <ShadowView
      propertyId={decodeURIComponent(propertyId)}
      {...(reservation ? { reservationId: reservation.trim() } : {})}
    />
  );
}
