import type { Metadata } from "next";

import { NewOfferView } from "../../../../../features/services/components/views";

export const metadata: Metadata = { title: "Neuer Service" };

export default function NewOfferPage() {
  return <NewOfferView />;
}
