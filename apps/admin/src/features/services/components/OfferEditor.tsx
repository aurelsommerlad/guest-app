"use client";

import {
  type CancellationPolicy,
  type ContentImage,
  HOUSE_SERVICE_CATEGORIES,
  type LocalizedText,
} from "@up/core";
import { Button } from "@up/ui";
import { useRouter } from "next/navigation";
import { type ReactNode, useActionState, useEffect, useState } from "react";

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
import { ImageEditor } from "../../media/ImageEditor";
import { CATEGORY_LABELS } from "../labels";
import {
  confirmOfferImageUploadAction,
  requestOfferImageUploadAction,
  type ServiceFormState,
} from "../actions";

export function FormSection({
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

export type OfferEditorValues = {
  title: LocalizedText;
  teaser: LocalizedText;
  body: LocalizedText | null;
  details: LocalizedText | null;
  category: string;
  fulfillment: string;
  cancellation: CancellationPolicy;
  heroImage: ContentImage | null;
};

const EMPTY: OfferEditorValues = {
  title: {},
  teaser: {},
  body: null,
  details: null,
  category: "comfort",
  fulfillment: "instant",
  cancellation: { type: "non-refundable" },
  heroImage: null,
};

/** The central offer: texts DE/EN, category, booking mode, cancellation and image. */
export function OfferEditor({
  values = EMPTY,
  action,
  readOnly,
  uploadEnabled,
  submitLabel,
}: {
  values?: OfferEditorValues;
  action: (previous: ServiceFormState, formData: FormData) => Promise<ServiceFormState>;
  readOnly: boolean;
  uploadEnabled: boolean;
  submitLabel: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const [cancellation, setCancellation] = useState(values.cancellation.type);
  const [image, setImage] = useState<EditorImage | undefined>(
    values.heroImage
      ? {
          src: values.heroImage.src,
          width: values.heroImage.width,
          height: values.heroImage.height,
          alt: { de: values.heroImage.alt.de ?? "", en: values.heroImage.alt.en ?? "" },
        }
      : undefined,
  );
  useEffect(() => {
    if (state.status === "created") router.push(state.url);
  }, [state, router]);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <fieldset disabled={readOnly} className="flex flex-col gap-6">
        <FormSection
          id="offer-general"
          title="Allgemein"
          description="Gilt für alle Objekte, an denen der Service angeboten wird."
        >
          <LocalizedPair label="Titel">
            <Input
              name="titleDe"
              aria-label="Titel Deutsch"
              defaultValue={values.title.de}
              required
              maxLength={120}
            />
            <Input
              name="titleEn"
              aria-label="Titel Englisch"
              defaultValue={values.title.en}
              placeholder="English"
              maxLength={120}
            />
          </LocalizedPair>
          <LocalizedPair label="Kurzbeschreibung">
            <Input
              name="teaserDe"
              aria-label="Kurzbeschreibung Deutsch"
              defaultValue={values.teaser.de}
              required
              maxLength={220}
            />
            <Input
              name="teaserEn"
              aria-label="Kurzbeschreibung Englisch"
              defaultValue={values.teaser.en}
              placeholder="English"
              maxLength={220}
            />
          </LocalizedPair>
          <LocalizedPair label="Beschreibung (optional)">
            <TextArea
              name="bodyDe"
              aria-label="Beschreibung Deutsch"
              defaultValue={values.body?.de}
              maxLength={4000}
            />
            <TextArea
              name="bodyEn"
              aria-label="Beschreibung Englisch"
              defaultValue={values.body?.en}
              placeholder="English"
              maxLength={4000}
            />
          </LocalizedPair>
          <LocalizedPair label="Hinweis, z. B. Uhrzeit (optional)">
            <Input
              name="detailsDe"
              aria-label="Hinweis Deutsch"
              defaultValue={values.details?.de}
              maxLength={400}
            />
            <Input
              name="detailsEn"
              aria-label="Hinweis Englisch"
              defaultValue={values.details?.en}
              placeholder="English"
              maxLength={400}
            />
          </LocalizedPair>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Kategorie" htmlFor="offer-category">
              <Select id="offer-category" name="category" defaultValue={values.category}>
                {HOUSE_SERVICE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {CATEGORY_LABELS[category]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Buchungsart (Standard)"
              htmlFor="offer-fulfillment"
              hint="Je Objekt änderbar."
            >
              <Select id="offer-fulfillment" name="fulfillment" defaultValue={values.fulfillment}>
                <option value="instant">Sofort buchbar</option>
                <option value="request">Auf Anfrage</option>
              </Select>
            </Field>
            <Field label="Storno" htmlFor="offer-cancellation">
              <Select
                id="offer-cancellation"
                name="cancellation"
                value={cancellation}
                onChange={(event) => {
                  setCancellation(event.target.value as CancellationPolicy["type"]);
                }}
              >
                <option value="non-refundable">Nicht stornierbar</option>
                <option value="free-until">Kostenlos stornierbar bis …</option>
                <option value="on-request">Auf Anfrage</option>
              </Select>
            </Field>
            {cancellation === "free-until" && (
              <Field label="Stunden vor Beginn" htmlFor="offer-cancellation-hours">
                <Input
                  id="offer-cancellation-hours"
                  name="cancellationHours"
                  type="number"
                  min={0}
                  max={720}
                  defaultValue={
                    values.cancellation.type === "free-until" ? values.cancellation.hoursBefore : 24
                  }
                />
              </Field>
            )}
          </div>
        </FormSection>
        <FormSection id="offer-image" title="Bild">
          <input type="hidden" name="heroImage" value={image ? JSON.stringify(image) : ""} />
          <ImageEditor
            label="Titelbild"
            image={image}
            onChange={setImage}
            uploadActions={{
              request: requestOfferImageUploadAction,
              confirm: confirmOfferImageUploadAction,
            }}
            uploadEnabled={uploadEnabled && !readOnly}
          />
        </FormSection>
      </fieldset>
      {state.status !== "created" && <FormMessage state={state} />}
      {!readOnly && (
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Speichern …" : submitLabel}
        </Button>
      )}
    </form>
  );
}
