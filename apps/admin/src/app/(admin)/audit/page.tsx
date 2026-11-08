import type { Metadata } from "next";

import { AuditView } from "../../../features/operations/components/views";

export const metadata: Metadata = { title: "Protokoll" };

export default function AuditPage() {
  return <AuditView />;
}
