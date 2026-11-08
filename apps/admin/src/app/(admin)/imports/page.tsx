import type { Metadata } from "next";

import { ImportsView } from "../../../features/operations/components/views";

export const metadata: Metadata = { title: "Datenimport" };

export default function ImportsPage() {
  return <ImportsView />;
}
