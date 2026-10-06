import { PropertyName } from "@up/ui";

import type { PropertyOption } from "../explore-admin-service";

/** Multiple choice of the tenant's properties – name and place, never technical ids. */
export function PropertyAssignment({
  properties,
  selected,
}: {
  properties: readonly PropertyOption[];
  selected: readonly string[];
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="type-eyebrow pb-1.5 text-text">Empfohlen für</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {properties.map((property) => (
          <label
            key={property.id}
            className="flex min-h-14 cursor-pointer items-center gap-3 rounded-control border border-border bg-background px-4 has-checked:border-text has-checked:bg-surface-raised"
          >
            <input
              type="checkbox"
              name="propertyIds"
              value={property.id}
              defaultChecked={selected.includes(property.id)}
              className="size-4 accent-current"
            />
            <span className="flex flex-col">
              <span className="type-body text-text">
                <PropertyName name={property.displayName} spokenName={property.spokenName} />
              </span>
              <span className="type-caption text-text-muted">{property.locationName}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="type-caption text-text-muted">
        Gäste sehen die Empfehlung nur in den ausgewählten Objekten. Ohne Auswahl erscheint sie
        nirgends.
      </p>
    </fieldset>
  );
}
