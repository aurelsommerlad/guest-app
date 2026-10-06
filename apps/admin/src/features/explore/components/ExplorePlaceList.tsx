"use client";

import { EXPLORE_CATEGORIES, type ExploreCategory } from "@up/core";
import { cx, Icon } from "@up/ui";
import Link from "next/link";
import { useId, useState } from "react";

import { Select } from "../../../components/fields";
import { StatusBadge } from "../../../components/StatusBadge";
import { filterHref, TOPIC_FILTERS, type TopicFilter } from "../../guide/topic-list";
import type { PlaceSummary, PropertyOption } from "../explore-admin-service";
import {
  filterPlaces,
  PLACE_FILTER_LABELS,
  type PropertyFilter,
  searchPlaces,
} from "../place-list";

export type ListedPlace = PlaceSummary & {
  /** Position in the current view (1-based); undefined for archived places. */
  position?: number;
};

type Props = {
  base: string;
  /** Property of the view, or null for "Alle Objekte". */
  viewProperty: string | null;
  filter: TopicFilter;
  counts: Record<TopicFilter, number>;
  places: readonly ListedPlace[];
  properties: readonly PropertyOption[];
  categoryLabels: Record<ExploreCategory, string>;
  hrefOf: Record<string, string>;
  moveAction?: (
    placeId: string,
    direction: "up" | "down",
    viewProperty: string | null,
  ) => Promise<void>;
  lastPosition: number;
};

/** Content list of EXPLORE places: status tabs, category/property filter, search and rows. */
export function ExplorePlaceList({
  base,
  viewProperty,
  filter,
  counts,
  places,
  properties,
  categoryLabels,
  hrefOf,
  moveAction,
  lastPosition,
}: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ExploreCategory | "all">("all");
  const [property, setProperty] = useState<PropertyFilter>("all");
  const ids = { search: useId(), category: useId(), property: useId() };
  const visible = searchPlaces(filterPlaces(places, { category, property }), query);
  const narrowed = query.trim() !== "" || category !== "all" || property !== "all";
  const sortable = moveAction !== undefined && filter === "all" && !narrowed;
  const propertyName = (id: string) => properties.find((item) => item.id === id)?.displayName ?? id;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 border-b border-border lg:flex-row lg:items-end lg:justify-between">
        <nav aria-label="Status" className="scrollbar-hidden -mb-px overflow-x-auto">
          <ul className="flex gap-6">
            {TOPIC_FILTERS.map((item) => {
              const active = item === filter;
              return (
                <li key={item}>
                  <Link
                    href={filterHref(base, item)}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "type-small flex min-h-11 items-center gap-2 border-b-2 whitespace-nowrap",
                      active
                        ? "border-text text-text"
                        : "border-transparent text-text-muted hover:text-text",
                    )}
                  >
                    {PLACE_FILTER_LABELS[item]}
                    <span className="type-caption rounded-full bg-surface px-2 py-0.5 tabular-nums">
                      {counts[item]}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="mb-3 grid gap-2 md:grid-cols-3 lg:flex lg:items-center">
          <label htmlFor={ids.category} className="sr-only">
            Kategorie
          </label>
          <Select
            id={ids.category}
            value={category}
            onChange={(event) => {
              setCategory(event.target.value as ExploreCategory | "all");
            }}
            className="lg:w-48"
          >
            <option value="all">Alle Kategorien</option>
            {EXPLORE_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {categoryLabels[item]}
              </option>
            ))}
          </Select>
          {viewProperty === null && (
            <>
              <label htmlFor={ids.property} className="sr-only">
                Objekt
              </label>
              <Select
                id={ids.property}
                value={typeof property === "string" ? property : property.propertyId}
                onChange={(event) => {
                  const value = event.target.value;
                  setProperty(
                    value === "all" || value === "unassigned" ? value : { propertyId: value },
                  );
                }}
                className="lg:w-48"
              >
                <option value="all">Alle Objekte</option>
                {properties.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                  </option>
                ))}
                <option value="unassigned">Ohne Objekt-Zuordnung</option>
              </Select>
            </>
          )}
          <div role="search" className="relative lg:w-64">
            <label htmlFor={ids.search} className="sr-only">
              Empfehlungen durchsuchen
            </label>
            <Icon
              name="search"
              size="sm"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-muted"
            />
            <input
              id={ids.search}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Empfehlungen durchsuchen …"
              className="type-small min-h-11 w-full rounded-control border border-border bg-surface-raised pr-3 pl-9 text-text placeholder:text-text-muted"
            />
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <p role="status" className="type-small py-6 text-text-muted">
          {narrowed
            ? "Keine Empfehlungen für diese Auswahl."
            : `Keine Empfehlungen mit dem Status „${PLACE_FILTER_LABELS[filter]}“.`}
        </p>
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Empfehlungen">
          {visible.map((place) => (
            <PlaceRow
              key={place.id}
              place={place}
              href={hrefOf[place.id] ?? base}
              categoryLabel={categoryLabels[place.category]}
              propertyNames={place.propertyIds.map(propertyName)}
              moveAction={sortable ? moveAction : undefined}
              viewProperty={viewProperty}
              lastPosition={lastPosition}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function PlaceRow({
  place,
  href,
  categoryLabel,
  propertyNames,
  moveAction,
  viewProperty,
  lastPosition,
}: {
  place: ListedPlace;
  href: string;
  categoryLabel: string;
  propertyNames: string[];
  moveAction?: Props["moveAction"];
  viewProperty: string | null;
  lastPosition: number;
}) {
  const title = place.title.de ?? "";
  const meta = (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={place.status} />
        {place.featured && (
          <span className="type-caption rounded-full bg-surface px-2.5 py-1 whitespace-nowrap text-text">
            Highlight
          </span>
        )}
      </div>
      <p className="type-caption text-text-muted">
        {propertyNames.length > 0 ? (
          propertyNames.join(", ")
        ) : (
          <span className="inline-flex items-center gap-1.5 text-text">
            <span aria-hidden className="size-1.5 rounded-full bg-status-draft-mark" />
            Keinem Objekt zugeordnet
          </span>
        )}
        {!place.englishComplete && " · EN unvollständig"}
      </p>
    </>
  );

  return (
    <li className="group relative flex items-center gap-3 rounded-card border border-border bg-surface-raised p-3 transition-colors hover:border-text-muted/50 md:gap-5 md:pr-4">
      <span className="type-caption hidden w-6 shrink-0 text-text-muted tabular-nums md:block">
        {place.position !== undefined ? String(place.position).padStart(2, "0") : "–"}
      </span>
      <span className="flex aspect-landscape w-20 shrink-0 items-center justify-center overflow-hidden rounded-control bg-surface text-text-muted md:w-32">
        {place.heroImageSrc ? (
          // Admin thumbnail of the place's own title image (storage or local fixture).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={place.heroImageSrc} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <Icon name="compass" size="lg" />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="type-eyebrow text-text-muted">
          {[categoryLabel, place.locality].filter(Boolean).join(" · ")}
        </p>
        <Link
          href={href}
          className="type-title truncate rounded-sm text-text after:absolute after:inset-0 after:rounded-card"
        >
          {title}
        </Link>
        <p className="type-small line-clamp-2 text-text-muted">{place.teaser.de}</p>
        <div className="flex flex-col gap-1.5 pt-1 md:hidden">{meta}</div>
      </div>
      <div className="hidden w-56 shrink-0 flex-col gap-1.5 md:flex lg:w-64">{meta}</div>
      {moveAction && place.position !== undefined && (
        <div className="relative z-10 flex flex-col" aria-label="Reihenfolge">
          <form action={moveAction.bind(null, place.id, "up", viewProperty)}>
            <button
              type="submit"
              aria-label={`${title} nach oben`}
              disabled={place.position === 1}
              className="flex size-9 items-center justify-center rounded-control text-text-muted hover:bg-surface hover:text-text disabled:opacity-30"
            >
              <Icon name="chevron-down" size="sm" className="rotate-180" />
            </button>
          </form>
          <form action={moveAction.bind(null, place.id, "down", viewProperty)}>
            <button
              type="submit"
              aria-label={`${title} nach unten`}
              disabled={place.position === lastPosition}
              className="flex size-9 items-center justify-center rounded-control text-text-muted hover:bg-surface hover:text-text disabled:opacity-30"
            >
              <Icon name="chevron-down" size="sm" />
            </button>
          </form>
        </div>
      )}
      <Icon
        name="chevron-right"
        size="sm"
        className="hidden shrink-0 text-text-muted group-hover:text-text md:block"
      />
    </li>
  );
}
