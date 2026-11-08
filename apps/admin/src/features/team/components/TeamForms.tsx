"use client";

import { ADMIN_ROLES, type AdminRole, type PropertyScope } from "@up/core";
import { Button } from "@up/ui";
import { useActionState, useState } from "react";

import { Field, FormMessage, Input, Select } from "../../../components/fields";
import { type AccessFormState, type InviteFormState, inviteMemberAction } from "../actions";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "../labels";

type PropertyOption = { id: string; displayName: string };

/** Role, "all properties" vs. selected properties – shared by invitation and edit form. */
function AccessFields({
  properties,
  assignableRoles,
  initial,
}: {
  properties: readonly PropertyOption[];
  assignableRoles: readonly AdminRole[];
  initial: { role: AdminRole; propertyScope: PropertyScope; propertyIds: readonly string[] };
}) {
  const [role, setRole] = useState<AdminRole>(initial.role);
  const [scope, setScope] = useState<PropertyScope>(initial.propertyScope);
  const ownerSelected = role === "owner";
  return (
    <>
      <Field label="Rolle" htmlFor="role" hint={ROLE_DESCRIPTIONS[role]}>
        <Select
          id="role"
          name="role"
          value={role}
          onChange={(event) => {
            setRole(event.target.value as AdminRole);
          }}
        >
          {ADMIN_ROLES.filter((candidate) => assignableRoles.includes(candidate)).map(
            (candidate) => (
              <option key={candidate} value={candidate}>
                {ROLE_LABELS[candidate]}
              </option>
            ),
          )}
        </Select>
      </Field>
      <fieldset className="flex flex-col gap-2" disabled={ownerSelected}>
        <legend className="type-eyebrow pb-1.5 text-text">Objekte</legend>
        <label className="type-body flex min-h-11 items-center gap-3">
          <input
            type="radio"
            name="propertyScope"
            value="all"
            checked={ownerSelected || scope === "all"}
            onChange={() => {
              setScope("all");
            }}
          />
          Alle Objekte (auch künftige)
        </label>
        <label className="type-body flex min-h-11 items-center gap-3">
          <input
            type="radio"
            name="propertyScope"
            value="selected"
            checked={!ownerSelected && scope === "selected"}
            onChange={() => {
              setScope("selected");
            }}
          />
          Nur ausgewählte Objekte
        </label>
        {!ownerSelected && scope === "selected" && (
          <div className="grid gap-1 pl-7 sm:grid-cols-2">
            {properties.map((property) => (
              <label key={property.id} className="type-body flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  name="propertyIds"
                  value={property.id}
                  defaultChecked={initial.propertyIds.includes(property.id)}
                />
                {property.displayName}
              </label>
            ))}
          </div>
        )}
        {ownerSelected && (
          <p className="type-caption text-text-muted">Inhaber/innen sehen immer alle Objekte.</p>
        )}
      </fieldset>
    </>
  );
}

export function InviteForm({
  properties,
  assignableRoles,
}: {
  properties: readonly PropertyOption[];
  assignableRoles: readonly AdminRole[];
}) {
  const [state, action, pending] = useActionState<InviteFormState, FormData>(inviteMemberAction, {
    status: "idle",
  });
  const link =
    state.status === "created" && typeof window !== "undefined"
      ? `${window.location.origin}${state.path}`
      : null;
  return (
    <form action={action} className="flex flex-col gap-5">
      <Field label="E-Mail" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="off" required />
      </Field>
      <AccessFields
        properties={properties}
        assignableRoles={assignableRoles}
        initial={{ role: "viewer", propertyScope: "all", propertyIds: [] }}
      />
      <FormMessage state={state} />
      {link && (
        <div className="flex flex-col gap-2 rounded-card border border-border p-4">
          <p className="type-small text-text">
            Sende diesen Link persönlich an die eingeladene Person. Er ist 7 Tage gültig und
            funktioniert genau einmal.
          </p>
          <Input
            readOnly
            value={link}
            aria-label="Einladungslink"
            onFocus={(e) => {
              e.target.select();
            }}
          />
        </div>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Einladen …" : "Einladung erstellen"}
      </Button>
    </form>
  );
}

export function AccessForm({
  action: boundAction,
  properties,
  assignableRoles,
  initial,
}: {
  action: (previous: AccessFormState, formData: FormData) => Promise<AccessFormState>;
  properties: readonly PropertyOption[];
  assignableRoles: readonly AdminRole[];
  initial: { role: AdminRole; propertyScope: PropertyScope; propertyIds: readonly string[] };
}) {
  const [state, action, pending] = useActionState<AccessFormState, FormData>(boundAction, {
    status: "idle",
  });
  return (
    <form action={action} className="flex flex-col gap-5">
      <AccessFields properties={properties} assignableRoles={assignableRoles} initial={initial} />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        Speichern
      </Button>
    </form>
  );
}
