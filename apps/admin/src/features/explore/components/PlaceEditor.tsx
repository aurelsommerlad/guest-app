"use client";

import { EXPLORE_CATEGORIES, type ExploreCategory, type ExplorePlace } from "@up/core";
import { Button } from "@up/ui";
import { type ReactNode, useActionState, useState } from "react";

import {
  Field,
  FormMessage,
  Input,
  LocalizedPair,
  Select,
  TextArea,
} from "../../../components/fields";
import { SectionHeader } from "../../../components/PageHeader";
import type { EditorImage } from "../../guide/components/content-types";
import type { ImageUploadActions } from "../../guide/components/image-upload";
import { ImageEditor } from "../../media/ImageEditor";
import type { ExploreFormState } from "../actions";
import type { PropertyOption } from "../explore-admin-service";
import { PropertyAssignment } from "./PropertyAssignment";

type Props = {
  place: Omit<ExplorePlace, "tenantId" | "status" | "sortOrder" | "translationState">;
  properties: readonly PropertyOption[];
  categoryLabels: Record<ExploreCategory, string>;
  saveAction: (previous: ExploreFormState, formData: FormData) => Promise<ExploreFormState>;
  uploadActions: ImageUploadActions;
  uploadEnabled: boolean;
};

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-5 rounded-card border border-border bg-surface-raised p-5 md:p-8"
    >
      <SectionHeader id={id} title={title} description={description} />
      {children}
    </section>
  );
}

/** One calm form for a recommendation; status changes live outside (page header). */
export function PlaceEditor({
  place,
  properties,
  categoryLabels,
  saveAction,
  uploadActions,
  uploadEnabled,
}: Props) {
  const [state, formAction, pending] = useActionState(saveAction, { status: "idle" });
  const [image, setImage] = useState<EditorImage | undefined>(
    place.heroImage
      ? {
          src: place.heroImage.src,
          width: place.heroImage.width,
          height: place.heroImage.height,
          alt: { de: place.heroImage.alt.de ?? "", en: place.heroImage.alt.en ?? "" },
        }
      : undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <Section id="place-general" title="Allgemein">
        <LocalizedPair label="Titel">
          <Input
            name="titleDe"
            aria-label="Titel Deutsch"
            defaultValue={place.title.de}
            required
            maxLength={120}
          />
          <Input
            name="titleEn"
            aria-label="Titel Englisch"
            defaultValue={place.title.en}
            placeholder="English"
            maxLength={120}
          />
        </LocalizedPair>
        <Field label="Kategorie" htmlFor="place-category">
          <Select id="place-category" name="category" defaultValue={place.category}>
            {EXPLORE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {categoryLabels[category]}
              </option>
            ))}
          </Select>
        </Field>
        <LocalizedPair label="Adressname (URL)">
          <Input
            name="slugDe"
            aria-label="Adressname Deutsch"
            defaultValue={place.slug.de}
            required
            maxLength={80}
          />
          <Input
            name="slugEn"
            aria-label="Adressname Englisch"
            defaultValue={place.slug.en}
            placeholder="english-name"
            maxLength={80}
          />
        </LocalizedPair>
      </Section>

      <Section
        id="place-text"
        title="Beschreibung"
        description="Kurz und persönlich – warum empfehlen wir diesen Ort?"
      >
        <LocalizedPair label="Kurzbeschreibung (Karte)">
          <Input
            name="teaserDe"
            aria-label="Kurzbeschreibung Deutsch"
            defaultValue={place.teaser.de}
            required
            maxLength={220}
          />
          <Input
            name="teaserEn"
            aria-label="Kurzbeschreibung Englisch"
            defaultValue={place.teaser.en}
            placeholder="English"
            maxLength={220}
          />
        </LocalizedPair>
        <LocalizedPair label="Beschreibung (optional)">
          <TextArea
            name="descriptionDe"
            aria-label="Beschreibung Deutsch"
            defaultValue={place.description?.de}
            maxLength={6000}
          />
          <TextArea
            name="descriptionEn"
            aria-label="Beschreibung Englisch"
            defaultValue={place.description?.en}
            placeholder="English"
            maxLength={6000}
          />
        </LocalizedPair>
        <LocalizedPair label="Unser Tipp (optional)">
          <TextArea
            name="tipDe"
            aria-label="Unser Tipp Deutsch"
            defaultValue={place.tip?.de}
            maxLength={1000}
          />
          <TextArea
            name="tipEn"
            aria-label="Unser Tipp Englisch"
            defaultValue={place.tip?.en}
            placeholder="English"
            maxLength={1000}
          />
        </LocalizedPair>
      </Section>

      <Section
        id="place-image"
        title="Bild"
        description="EXPLORE lebt von Fotos. Ohne Titelbild zeigt die App eine ruhige Fläche statt eines Fotos."
      >
        <input type="hidden" name="heroImage" value={image ? JSON.stringify(image) : ""} />
        <ImageEditor
          label="Titelbild"
          image={image}
          onChange={setImage}
          uploadActions={uploadActions}
          uploadEnabled={uploadEnabled}
        />
      </Section>

      <Section
        id="place-contact"
        title="Ort & Kontakt"
        description="Aktionen in der App erscheinen nur, wenn die Angabe gepflegt ist."
      >
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Adresse" htmlFor="place-address" hint="Eine Zeile pro Adresszeile">
            <TextArea
              id="place-address"
              name="address"
              defaultValue={place.address}
              maxLength={300}
              className="min-h-20"
            />
          </Field>
          <Field label="Ort (auf der Karte)" htmlFor="place-locality" hint="z. B. Lindau">
            <Input
              id="place-locality"
              name="locality"
              defaultValue={place.locality}
              maxLength={80}
            />
          </Field>
          <Field
            label="Karten-Link (optional)"
            htmlFor="place-maps"
            hint="Sonst wird die Adresse für die Route verwendet"
          >
            <Input
              id="place-maps"
              name="mapsUrl"
              type="url"
              inputMode="url"
              defaultValue={place.mapsUrl}
              placeholder="https://"
            />
          </Field>
          <Field label="Website" htmlFor="place-website">
            <Input
              id="place-website"
              name="websiteUrl"
              type="url"
              inputMode="url"
              defaultValue={place.websiteUrl}
              placeholder="https://"
            />
          </Field>
          <Field label="Telefon" htmlFor="place-phone">
            <Input
              id="place-phone"
              name="phone"
              type="tel"
              defaultValue={place.phone}
              maxLength={40}
              placeholder="+49 …"
            />
          </Field>
          <Field label="Reservierungslink" htmlFor="place-reservation">
            <Input
              id="place-reservation"
              name="reservationUrl"
              type="url"
              inputMode="url"
              defaultValue={place.reservationUrl}
              placeholder="https://"
            />
          </Field>
        </div>
        <LocalizedPair label="Öffnungszeiten-Hinweis (optional)">
          <Input
            name="openingHoursDe"
            aria-label="Öffnungszeiten Deutsch"
            defaultValue={place.openingHours?.de}
            maxLength={400}
            placeholder="z. B. Mi–So ab 17 Uhr"
          />
          <Input
            name="openingHoursEn"
            aria-label="Öffnungszeiten Englisch"
            defaultValue={place.openingHours?.en}
            placeholder="English"
            maxLength={400}
          />
        </LocalizedPair>
      </Section>

      <Section id="place-assignment" title="Zuordnung">
        <PropertyAssignment properties={properties} selected={place.propertyIds} />
      </Section>

      <Section
        id="place-display"
        title="Darstellung"
        description="Die Reihenfolge änderst Du in der Liste mit den Pfeilen."
      >
        <label className="type-body flex items-center gap-3">
          <input
            type="checkbox"
            name="featured"
            defaultChecked={place.featured}
            className="size-4 accent-current"
          />
          Highlight – erscheint zuerst und mit größerem Bild
        </label>
      </Section>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-4 bg-background px-1 py-4">
        <Button type="submit" disabled={pending}>
          Empfehlung speichern
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
