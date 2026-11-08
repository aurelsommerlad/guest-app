import type { Metadata } from "next";

import { BookingsView } from "../../../features/operations/components/views";

export const metadata: Metadata = { title: "Bestellungen" };

export default function Page() {
  return <BookingsView viewProperty={null} />;
}
