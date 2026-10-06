"use client";

import { EXPLORE_CATEGORIES, type ExploreCategory } from "@up/core";
import { Button } from "@up/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { Field, FormMessage, Input, LocalizedPair, Select } from "../../../components/fields";
import type { ExploreFormState } from "../actions";
import type { PropertyOption } from "../explore-admin-service";
import { PropertyAssignment } from "./PropertyAssignment";

type Props = {
  properties: readonly PropertyOption[];
  /** Pre-selected property (the current context), if any. */
  preselected: readonly string[];
  categoryLabels: Record<ExploreCategory, string>;
  action: (previous: ExploreFormState, formData: FormData) => Promise<ExploreFormState>;
};

/** First step: the essentials. Everything else follows in the editor. */
export function NewPlaceForm({ properties, preselected, categoryLabels, action }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const router = useRouter();
  useEffect(() => {
    if (state.status === "created") router.push(state.url);
  }, [state, router]);
  return (
    <form action={formAction} className="flex flex-col gap-6">
      <LocalizedPair label="Titel">
        <Input name="titleDe" aria-label="Titel Deutsch" required maxLength={120} />
        <Input name="titleEn" aria-label="Titel Englisch" placeholder="English" maxLength={120} />
      </LocalizedPair>
      <Field label="Kategorie" htmlFor="new-place-category">
        <Select id="new-place-category" name="category" required defaultValue="">
          <option value="" disabled>
            Bitte wählen
          </option>
          {EXPLORE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {categoryLabels[category]}
            </option>
          ))}
        </Select>
      </Field>
      <LocalizedPair label="Kurzbeschreibung">
        <Input name="teaserDe" aria-label="Kurzbeschreibung Deutsch" required maxLength={220} />
        <Input
          name="teaserEn"
          aria-label="Kurzbeschreibung Englisch"
          placeholder="English"
          maxLength={220}
        />
      </LocalizedPair>
      <PropertyAssignment properties={properties} selected={preselected} />
      <FormMessage state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          Empfehlung anlegen
        </Button>
      </div>
    </form>
  );
}
