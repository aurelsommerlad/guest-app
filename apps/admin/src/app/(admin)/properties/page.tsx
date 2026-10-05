import { Heading, Text } from "@up/ui";
import { listPropertiesForTenant } from "@up/db";
import type { Metadata } from "next";
import Link from "next/link";

import { requireAdmin } from "../../../features/auth/server";
import { getDatabase } from "../../../server/database";

export const metadata: Metadata = { title: "Objekte" };

export default async function PropertiesPage() {
  const admin = await requireAdmin();
  const properties = await listPropertiesForTenant(getDatabase(), { tenantId: admin.tenantId });
  return (
    <div className="flex flex-col gap-8">
      <Heading level={1} variant="title-lg">
        Objekte
      </Heading>
      <ul className="grid gap-3 md:grid-cols-2">
        {properties.map((property) => (
          <li key={property.id}>
            <Link
              href={`/properties/${property.id}/guide`}
              className="flex min-h-24 flex-col justify-between gap-2 rounded-card bg-surface p-5 hover:bg-surface-raised"
            >
              <span className="type-title text-text">{property.displayName}</span>
              <Text variant="small" tone="muted">
                {property.locationName}
              </Text>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
