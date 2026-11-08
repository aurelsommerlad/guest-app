import type { Metadata } from "next";

import { CatalogListView } from "../../../features/services/components/views";

export const metadata: Metadata = { title: "Servicekatalog" };

export default function ServicesPage() {
  return <CatalogListView viewProperty={null} />;
}
