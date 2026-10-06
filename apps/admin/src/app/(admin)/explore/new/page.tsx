import type { Metadata } from "next";

import { NewPlaceView } from "../../../../features/explore/components/views";

export const metadata: Metadata = { title: "Neue Empfehlung" };

export default function NewPlacePage() {
  return <NewPlaceView viewProperty={null} />;
}
