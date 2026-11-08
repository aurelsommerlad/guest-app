import type { Metadata } from "next";

import { BookingDetailView } from "../../../../../features/operations/components/views";

export const metadata: Metadata = { title: "Bestellungen" };

type Props = { params: Promise<{ bookingId: string }> };

export default async function Page({ params }: Props) {
  const { bookingId } = await params;
  return <BookingDetailView bookingId={bookingId} />;
}
