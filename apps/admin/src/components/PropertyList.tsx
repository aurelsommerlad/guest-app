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
    <ul className="flex flex-col border-t border-border">
      {properties.map((property) => (
        <li key={property.id} className="border-b border-border">
          <Link
            href={href(property.id)}
            className="group -mx-3 flex min-h-20 items-center gap-6 rounded-card px-3 hover:bg-surface md:-mx-4 md:px-4"
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
