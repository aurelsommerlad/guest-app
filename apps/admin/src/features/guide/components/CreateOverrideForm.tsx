"use client";

import { type Unit } from "@up/core";
import { Button } from "@up/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { Field, FormMessage, Select } from "../../../components/fields";
import { type GuideFormState } from "../actions";

type Props = {
  units: readonly Pick<Unit, "id" | "displayName">[];
  action: (previous: GuideFormState, formData: FormData) => Promise<GuideFormState>;
};

/** Adds an apartment variant and opens it (one client navigation). */
export function CreateOverrideForm({ units, action }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const router = useRouter();
  useEffect(() => {
    if (state.status === "created") router.push(state.url);
  }, [state, router]);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Variante für Apartment" htmlFor="override-unit">
          <Select id="override-unit" name="unitId">
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="secondary" disabled={pending}>
          Variante anlegen
        </Button>
      </div>
      {state.status !== "created" && <FormMessage state={state} />}
    </form>
  );
}
