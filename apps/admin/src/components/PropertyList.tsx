import { Icon, PropertyName } from "@up/ui";
import Link from "next/link";

import { type ContextProperty } from "../features/property-context/property-context";

/**
 * Calm selection list of properties (name, place, destination). Used by "Objekte" and by
 * property modules when "Alle Objekte" is selected but one property is needed.
 */
export function PropertyList({
  properties,
  href,
  destination,
}: {
  properties: readonly ContextProperty[];
  href: (propertyId: string) => string;
  /** Short label of where a row leads, e.g. "Guide". */
  destination: string;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {properties.map((property) => (
        <li key={property.id}>
          <Link
            href={href(property.id)}
            className="group flex min-h-20 items-center gap-6 rounded-card border border-border bg-surface-raised px-5 transition-colors hover:border-text-muted/50"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1 md:flex-row md:items-baseline md:gap-6">
              <span className="type-title text-text md:w-48 md:shrink-0">
                <PropertyName name={property.displayName} spokenName={property.spokenName} />
              </span>
              <span className="type-small text-text-muted">{property.locationName}</span>
            </span>
            <span className="type-small flex items-center gap-2 text-text-muted group-hover:text-text">
              {destination}
              <Icon name="chevron-right" size="sm" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
