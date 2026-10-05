"use client";

import { GUIDE_ICONS, type GuideTopic } from "@up/core";
import { Button } from "@up/ui";
import { useActionState } from "react";

import { Field, FormMessage, Input, LocalizedPair, Select } from "../../../components/fields";
import { type GuideFormState } from "../actions";
import { iconLabels } from "./labels";

type Props = {
  topic: Pick<GuideTopic, "title" | "shortDescription" | "eyebrow" | "slug" | "icon">;
  action: (previous: GuideFormState, formData: FormData) => Promise<GuideFormState>;
};

/** Title, description, URL name and icon – shared by all apartments. */
export function TopicMetaForm({ topic, action }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  return (
    <form action={formAction} className="flex flex-col gap-6">
      <LocalizedPair label="Titel">
        <Input
          name="titleDe"
          aria-label="Titel Deutsch"
          defaultValue={topic.title.de}
          required
          maxLength={120}
        />
        <Input
          name="titleEn"
          aria-label="Titel Englisch"
          defaultValue={topic.title.en}
          placeholder="English"
          maxLength={120}
        />
      </LocalizedPair>
      <LocalizedPair label="Kurzbeschreibung">
        <Input
          name="shortDescriptionDe"
          aria-label="Kurzbeschreibung Deutsch"
          defaultValue={topic.shortDescription.de}
          required
          maxLength={200}
        />
        <Input
          name="shortDescriptionEn"
          aria-label="Kurzbeschreibung Englisch"
          defaultValue={topic.shortDescription.en}
          placeholder="English"
          maxLength={200}
        />
      </LocalizedPair>
      <LocalizedPair label="Dachzeile (optional)">
        <Input
          name="eyebrowDe"
          aria-label="Dachzeile Deutsch"
          defaultValue={topic.eyebrow?.de}
          maxLength={60}
        />
        <Input
          name="eyebrowEn"
          aria-label="Dachzeile Englisch"
          defaultValue={topic.eyebrow?.en}
          placeholder="English"
          maxLength={60}
        />
      </LocalizedPair>
      <LocalizedPair label="Adressname (URL)">
        <Input
          name="slugDe"
          aria-label="Adressname Deutsch"
          defaultValue={topic.slug.de}
          required
          pattern="[a-z0-9][a-z0-9\-]*"
        />
        <Input
          name="slugEn"
          aria-label="Adressname Englisch"
          defaultValue={topic.slug.en}
          placeholder="english-name"
          pattern="[a-z0-9][a-z0-9\-]*"
        />
      </LocalizedPair>
      <Field label="Symbol" htmlFor="icon">
        <Select id="icon" name="icon" defaultValue={topic.icon}>
          {GUIDE_ICONS.map((icon) => (
            <option key={icon} value={icon}>
              {iconLabels[icon]}
            </option>
          ))}
        </Select>
      </Field>
      <FormMessage state={state} />
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        Angaben speichern
      </Button>
    </form>
  );
}
