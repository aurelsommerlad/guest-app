import type { Metadata } from "next";

import { ExtensionsView } from "../../../features/operations/components/views";

export const metadata: Metadata = { title: "Verlängerungen" };

export default function Page() {
  return <ExtensionsView viewProperty={null} />;
}
