import type { Metadata } from "next";

import { ExtensionNightsView } from "../../../features/operations/components/views";

export const metadata: Metadata = { title: "Verlängerungsnächte" };

export default function ExtensionNightsPage() {
  return <ExtensionNightsView viewProperty={null} />;
}
