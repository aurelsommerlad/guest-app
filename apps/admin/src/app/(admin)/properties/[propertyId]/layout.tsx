import { getPropertyById } from "@up/db";
import { Text } from "@up/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { requireAdmin } from "../../../../features/auth/server";
import { propertyModules } from "../../../../navigation";
import { getDatabase } from "../../../../server/database";

type Props = { children: ReactNode; params: Promise<{ propertyId: string }> };

/** Property frame: name and the property's modules (today: Guide). */
export default async function PropertyLayout({ children, params }: Props) {
  const { propertyId } = await params;
  const admin = await requireAdmin();
  const property = await getPropertyById(getDatabase(), { tenantId: admin.tenantId }, propertyId);
  if (!property) notFound();
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link
          href="/properties"
          className="type-small self-start rounded-sm text-text-muted hover:underline"
        >
          ← Objekte
        </Link>
        <div className="flex flex-wrap items-baseline gap-3">
          <p className="type-title-lg text-text">{property.displayName}</p>
          <Text variant="small" tone="muted">
            {property.locationName}
          </Text>
        </div>
        <nav aria-label="Bereiche des Objekts">
          <ul className="flex gap-2 border-b border-border">
            {propertyModules.map((module) => (
              <li key={module.id}>
                <Link
                  href={module.href(property.id)}
                  className="type-small inline-flex min-h-11 items-center border-b-2 border-action px-3 text-text"
                >
                  {module.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      {children}
    </div>
  );
}
