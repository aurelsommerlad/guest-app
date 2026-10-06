import type { ExploreCategory } from "@up/core";
import { buttonStyles } from "@up/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState, PageHeader } from "../../../components/PageHeader";
import { StatusBadge } from "../../../components/StatusBadge";
import { requireAdmin } from "../../auth/server";
import { mediaStorageConfig } from "../../guide/server";
import { filterHref, matchesFilter, parseTopicFilter, topicCounts } from "../../guide/topic-list";
import {
  confirmPlaceImageUploadAction,
  createPlaceAction,
  movePlaceAction,
  requestPlaceImageUploadAction,
  savePlaceAction,
} from "../actions";
import { CATEGORY_LABELS, loadExploreOverview, loadPlace } from "../explore-admin-service";
import { explorePath, newPlacePath, placePath } from "../paths";
import { exploreDeps } from "../server";
import { ExplorePlaceList, type ListedPlace } from "./ExplorePlaceList";
import { NewPlaceForm } from "./NewPlaceForm";
import { PlaceEditor } from "./PlaceEditor";
import { PlaceStatusActions } from "./PlaceStatusActions";

const categoryLabels: Record<ExploreCategory, string> = CATEGORY_LABELS;

/** EXPLORE list – all places of the tenant (viewProperty null) or one property's places. */
export async function ExploreListView({
  viewProperty,
  searchParams,
}: {
  viewProperty: string | null;
  searchParams: { status?: string; archived?: string };
}) {
  const admin = await requireAdmin();
  const overview = await loadExploreOverview(
    exploreDeps(),
    { tenantId: admin.tenantId },
    viewProperty,
  );
  if (!overview) notFound();
  const base = explorePath(viewProperty);
  const filter = parseTopicFilter(searchParams);

  let position = 0;
  const places: ListedPlace[] = overview.places.map((place) =>
    place.status === "archived" ? place : { ...place, position: ++position },
  );
  const hrefOf = Object.fromEntries(
    places.map((place) => [place.id, placePath(viewProperty, place.id)]),
  );
  const showingArchived = filter === "archived";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Explore"
        description={
          viewProperty === null
            ? "Alle Empfehlungen Deines Unternehmens – mit ihrer Zuordnung zu den Objekten."
            : "Empfehlungen, die Gäste dieses Objekts in der App sehen – in der Reihenfolge der Gäste-Ansicht."
        }
        actions={
          <>
            <Link
              href={showingArchived ? base : filterHref(base, "archived")}
              className={buttonStyles("secondary")}
            >
              {showingArchived ? "Archivierte ausblenden" : "Archivierte anzeigen"}
            </Link>
            <Link href={newPlacePath(viewProperty)} className={buttonStyles("primary")}>
              Empfehlung hinzufügen
            </Link>
          </>
        }
      />
      {places.length === 0 ? (
        <EmptyState
          icon="compass"
          title="Noch keine Empfehlungen"
          description="Lege die erste Empfehlung an – ein Restaurant, einen Ausflug oder einen besonderen Ort."
          action={
            <Link href={newPlacePath(viewProperty)} className={buttonStyles("primary")}>
              Empfehlung hinzufügen
            </Link>
          }
        />
      ) : (
        <ExplorePlaceList
          key={`${viewProperty ?? "all"}-${filter}`}
          base={base}
          viewProperty={viewProperty}
          filter={filter}
          counts={topicCounts(places)}
          places={places.filter((place) => matchesFilter(place.status, filter))}
          properties={overview.properties}
          categoryLabels={categoryLabels}
          hrefOf={hrefOf}
          moveAction={movePlaceAction}
          lastPosition={position}
        />
      )}
    </div>
  );
}

export async function NewPlaceView({ viewProperty }: { viewProperty: string | null }) {
  const admin = await requireAdmin();
  const overview = await loadExploreOverview(
    exploreDeps(),
    { tenantId: admin.tenantId },
    viewProperty,
  );
  if (!overview) notFound();
  return (
    <div className="flex max-w-224 flex-col gap-8">
      <PageHeader
        title="Neue Empfehlung"
        breadcrumbs={[{ label: "Explore", href: explorePath(viewProperty) }]}
        description="Zuerst das Wichtigste – Bild, Beschreibung und Kontakt folgen im nächsten Schritt."
      />
      <section className="rounded-card border border-border bg-surface-raised p-5 md:p-8">
        <NewPlaceForm
          properties={overview.properties}
          preselected={viewProperty ? [viewProperty] : []}
          categoryLabels={categoryLabels}
          action={createPlaceAction.bind(null, viewProperty)}
        />
      </section>
    </div>
  );
}

export async function PlaceEditorView({
  viewProperty,
  placeId,
  error,
}: {
  viewProperty: string | null;
  placeId: string;
  error?: string;
}) {
  const admin = await requireAdmin();
  const loaded = await loadPlace(exploreDeps(), { tenantId: admin.tenantId }, placeId);
  if (!loaded) notFound();
  const { place, properties, englishComplete } = loaded;
  const assigned = properties.filter((property) => place.propertyIds.includes(property.id));
  return (
    <div className="flex max-w-224 flex-col gap-8">
      <PageHeader
        breadcrumbs={[{ label: "Explore", href: explorePath(viewProperty) }]}
        eyebrow={categoryLabels[place.category]}
        title={place.title.de}
        status={<StatusBadge status={place.status} />}
        description={
          <>
            {assigned.length > 0
              ? `Empfohlen für ${assigned.map((property) => property.displayName).join(", ")}`
              : "Noch keinem Objekt zugeordnet – Gäste sehen diese Empfehlung nirgends."}
            {englishComplete ? " · DE, EN" : " · Englisch unvollständig"}
          </>
        }
      />
      {error && (
        <p role="status" className="type-small rounded-card bg-surface p-3">
          {error}
        </p>
      )}
      <PlaceStatusActions
        placeId={place.id}
        status={place.status}
        deletable={!place.firstPublishedAt}
        viewProperty={viewProperty}
      />
      <PlaceEditor
        key={place.id}
        place={place}
        properties={properties}
        categoryLabels={categoryLabels}
        saveAction={savePlaceAction.bind(null, place.id)}
        uploadActions={{
          request: requestPlaceImageUploadAction,
          confirm: confirmPlaceImageUploadAction,
        }}
        uploadEnabled={mediaStorageConfig() !== undefined}
      />
    </div>
  );
}
