import type { Metadata } from "next";

import { EmptyState, PageHeader } from "../../../components/PageHeader";
import { PropertyList } from "../../../components/PropertyList";
import { getTenantProperties } from "../../../features/property-context/server";

export const metadata: Metadata = { title: "Guide" };

/**
 * Guide with "Alle Objekte": guide content belongs to one property, so nothing is mixed –
 * the admin chooses the property first.
 */
export default async function GuideAllPropertiesPage() {
  const properties = await getTenantProperties();
  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Guide"
        description="Guide-Inhalte gelten jeweils für ein Objekt. Wähle das Objekt, dessen Guide Du bearbeiten möchtest."
      />
      {properties.length === 0 ? (
        <EmptyState title="Noch keine Objekte" />
      ) : (
        <PropertyList
          properties={properties}
          href={(propertyId) => `/guide/${propertyId}`}
          destination="Guide öffnen"
        />
      )}
    </div>
  );
}
