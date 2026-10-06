import type { Metadata } from "next";

import { EmptyState, PageHeader } from "../../../components/PageHeader";
import { PropertyList } from "../../../components/PropertyList";
import { getTenantProperties } from "../../../features/property-context/server";
import { adminModules, moduleHref } from "../../../navigation";

export const metadata: Metadata = { title: "Objekte" };

/** The tenant's properties – choosing one opens its first property module. */
export default async function PropertiesPage() {
  const properties = await getTenantProperties();
  const firstModule = adminModules.find((candidate) => candidate.scope.kind === "property");
  return (
    <div className="flex flex-col gap-10">
      <PageHeader title="Objekte" description="Alle Objekte Deines Unternehmens." />
      {properties.length === 0 || !firstModule ? (
        <EmptyState
          title="Noch keine Objekte"
          description="Objekte werden aus den Stammdaten übernommen."
        />
      ) : (
        <PropertyList
          properties={properties}
          href={(propertyId) => moduleHref(firstModule, propertyId)}
          destination={firstModule.label}
        />
      )}
    </div>
  );
}
