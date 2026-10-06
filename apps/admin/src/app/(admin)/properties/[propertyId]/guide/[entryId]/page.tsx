import { Heading, Text } from "@up/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusBadge } from "../../../../../../components/StatusBadge";
import { requireAdmin } from "../../../../../../features/auth/server";
import {
  confirmImageUploadAction,
  createOverrideAction,
  requestImageUploadAction,
  saveContentAction,
  updateTopicAction,
} from "../../../../../../features/guide/actions";
import { CreateOverrideForm } from "../../../../../../features/guide/components/CreateOverrideForm";
import { ContentEditor } from "../../../../../../features/guide/components/ContentEditor";
import { toEditorContent } from "../../../../../../features/guide/components/content-mapping";
import { StatusActions } from "../../../../../../features/guide/components/StatusActions";
import { TopicMetaForm } from "../../../../../../features/guide/components/TopicMetaForm";
import {
  loadGuideEntry,
  loadPropertyGuide,
} from "../../../../../../features/guide/guide-admin-service";
import { guideDeps, mediaStorageConfig } from "../../../../../../features/guide/server";

export const metadata: Metadata = { title: "Thema bearbeiten" };

type Props = {
  params: Promise<{ propertyId: string; entryId: string }>;
  searchParams: Promise<{ error?: string }>;
};

/** Edits a topic (title, content, variants) or one apartment variant (content). */
export default async function GuideEntryPage({ params, searchParams }: Props) {
  const [{ propertyId, entryId }, { error }] = await Promise.all([params, searchParams]);
  const admin = await requireAdmin();
  const context = { tenantId: admin.tenantId };
  const deps = guideDeps();
  const loaded = await loadGuideEntry(deps, context, entryId);
  if (!loaded || loaded.property.id !== propertyId) notFound();
  const { entry, topic, units } = loaded;
  const base = `/properties/${propertyId}/guide`;
  const editor = (
    <ContentEditor
      // A fresh editor per entry: never carry state from one topic/variant to another.
      key={entry.id}
      initial={toEditorContent(entry)}
      saveAction={saveContentAction.bind(null, entry.id)}
      uploadActions={{
        request: requestImageUploadAction.bind(null, propertyId),
        confirm: confirmImageUploadAction.bind(null, propertyId),
      }}
      uploadEnabled={mediaStorageConfig() !== undefined}
    />
  );
  const unitName = (unitId: string) =>
    units.find((unit) => unit.id === unitId)?.displayName ?? unitId;

  if (entry.kind === "override") {
    return (
      <div className="flex max-w-4xl flex-col gap-8">
        <Link
          href={topic ? `${base}/${topic.id}` : base}
          className="type-small self-start rounded-sm text-text-muted hover:underline"
        >
          ← {topic?.title.de ?? "Guide-Themen"}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Text variant="eyebrow" tone="muted">
              Apartment-Variante
            </Text>
            <Heading level={1} variant="title">
              {topic?.title.de ?? entry.key} · {unitName(entry.scope.unitId)}
            </Heading>
          </div>
          <StatusBadge status={entry.status} />
        </div>
        <Text variant="small" tone="muted">
          Gäste dieses Apartments sehen diesen Inhalt statt des allgemeinen Inhalts – sobald die
          Variante veröffentlicht ist. Titel und Reihenfolge kommen vom Thema.
        </Text>
        {error && (
          <p role="status" className="type-small rounded-card bg-surface p-3">
            {error}
          </p>
        )}
        <StatusActions
          entryId={entry.id}
          status={entry.status}
          deletable={!entry.firstPublishedAt}
        />
        {editor}
      </div>
    );
  }

  const guide = await loadPropertyGuide(deps, context, propertyId);
  const summary = guide?.topics.find((item) => item.id === entry.id);
  const overrides = summary?.overrides ?? [];
  const availableUnits = units.filter(
    (unit) => !overrides.some((override) => override.unitId === unit.id),
  );

  return (
    <div className="flex max-w-4xl flex-col gap-10">
      <Link
        href={base}
        className="type-small self-start rounded-sm text-text-muted hover:underline"
      >
        ← Guide-Themen
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Text variant="eyebrow" tone="muted">
            {entry.scope.level === "unit"
              ? `Nur Apartment ${unitName(entry.scope.unitId)}`
              : "Gilt für das gesamte Objekt"}
          </Text>
          <Heading level={1} variant="title">
            {entry.title.de}
          </Heading>
        </div>
        <StatusBadge status={entry.status} />
      </div>
      {error && (
        <p role="status" className="type-small rounded-card bg-surface p-3">
          {error}
        </p>
      )}
      <StatusActions entryId={entry.id} status={entry.status} deletable={!entry.firstPublishedAt} />

      <section className="flex flex-col gap-4" aria-labelledby="meta-heading">
        <h2 id="meta-heading" className="type-title text-text">
          Angaben
        </h2>
        <TopicMetaForm
          key={entry.id}
          topic={entry}
          action={updateTopicAction.bind(null, entry.id)}
        />
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="content-heading">
        <h2 id="content-heading" className="type-title text-text">
          {entry.scope.level === "property" ? "Allgemeiner Inhalt" : "Inhalt"}
        </h2>
        {editor}
      </section>

      {entry.scope.level === "property" && (
        <section className="flex flex-col gap-4" aria-labelledby="variants-heading">
          <h2 id="variants-heading" className="type-title text-text">
            Apartment-Varianten
          </h2>
          <Text variant="small" tone="muted">
            Für Apartments mit eigenen Angaben (z. B. WLAN). Alle anderen Apartments sehen den
            allgemeinen Inhalt.
          </Text>
          {overrides.length > 0 && (
            <ul className="flex flex-col gap-2">
              {overrides.map((override) => (
                <li
                  key={override.id}
                  className="flex items-center justify-between gap-3 rounded-card bg-surface p-4"
                >
                  <Link
                    href={`${base}/${override.id}`}
                    className="type-body rounded-sm text-text hover:underline"
                  >
                    Apartment {override.unitName}
                  </Link>
                  <StatusBadge status={override.status} />
                </li>
              ))}
            </ul>
          )}
          {availableUnits.length > 0 && (
            <CreateOverrideForm
              units={availableUnits.map((unit) => ({ id: unit.id, displayName: unit.displayName }))}
              action={createOverrideAction.bind(null, entry.id)}
            />
          )}
        </section>
      )}
    </div>
  );
}
