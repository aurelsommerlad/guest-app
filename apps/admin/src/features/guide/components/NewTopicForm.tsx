"use client";

import { GUIDE_ICONS, type Unit } from "@up/core";
import { Button } from "@up/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { Field, FormMessage, Input, LocalizedPair, Select } from "../../../components/fields";
import { type GuideFormState } from "../actions";
import { iconLabels } from "./labels";

type Props = {
  units: readonly Pick<Unit, "id" | "displayName">[];
  action: (previous: GuideFormState, formData: FormData) => Promise<GuideFormState>;
};

export function NewTopicForm({ units, action }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const [scope, setScope] = useState<"property" | "unit">("property");
  const router = useRouter();
  useEffect(() => {
    if (state.status === "created") router.push(state.url);
  }, [state, router]);
  return (
    <form action={formAction} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="type-eyebrow pb-1.5 text-text">Gültigkeit</legend>
        <label className="type-body flex items-center gap-3">
          <input
            type="radio"
            name="scope"
            value="property"
            checked={scope === "property"}
            onChange={() => {
              setScope("property");
            }}
          />
          Gilt für das gesamte Objekt
        </label>
        <label className="type-body flex items-center gap-3">
          <input
            type="radio"
            name="scope"
            value="unit"
            checked={scope === "unit"}
            onChange={() => {
              setScope("unit");
            }}
          />
          Apartment-spezifisches Thema
        </label>
        {scope === "unit" && (
          <Field label="Apartment" htmlFor="unitId">
            <Select id="unitId" name="unitId" required>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.displayName}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <p className="type-caption text-text-muted">
          Unterschiedliche Inhalte je Apartment (z. B. WLAN) legst Du als Variante eines
          Objekt-Themas an.
        </p>
      </fieldset>
      <LocalizedPair label="Titel">
        <Input
          name="titleDe"
          aria-label="Titel Deutsch"
          placeholder="Deutsch"
          required
          maxLength={120}
        />
        <Input name="titleEn" aria-label="Titel Englisch" placeholder="English" maxLength={120} />
      </LocalizedPair>
      <LocalizedPair label="Kurzbeschreibung">
        <Input
          name="shortDescriptionDe"
          aria-label="Kurzbeschreibung Deutsch"
          placeholder="Deutsch"
          required
          maxLength={200}
        />
        <Input
          name="shortDescriptionEn"
          aria-label="Kurzbeschreibung Englisch"
          placeholder="English"
          maxLength={200}
        />
      </LocalizedPair>
      <Field label="Symbol" htmlFor="icon">
        <Select id="icon" name="icon" defaultValue="info">
          {GUIDE_ICONS.map((icon) => (
            <option key={icon} value={icon}>
              {iconLabels[icon]}
            </option>
          ))}
        </Select>
      </Field>
      {state.status !== "created" && <FormMessage state={state} />}
      <Button type="submit" disabled={pending} className="self-start">
        Thema anlegen
      </Button>
    </form>
  );
}
