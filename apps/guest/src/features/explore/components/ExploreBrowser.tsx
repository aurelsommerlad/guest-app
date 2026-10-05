"use client";

import { type ExploreFilter } from "@up/core";
import { EditorialImageCard, FilterBar, type FilterBarItem, Text } from "@up/ui";
import Image from "next/image";
import { useState } from "react";

import { Link } from "../../../i18n/navigation";
import { type ExploreCard } from "../model";

export type ExploreBrowserProps = {
  cards: readonly ExploreCard[];
  filters: readonly FilterBarItem<ExploreFilter>[];
  filterLabel: string;
  /** Pre-translated "n recommendations" per filter (announced to screen readers). */
  countLabels: Readonly<Record<ExploreFilter, string>>;
  emptyText: string;
  placesHeading: string;
};

/** Category filter + photographic recommendation cards. Filtering happens in the browser. */
export function ExploreBrowser({
  cards,
  filters,
  filterLabel,
  countLabels,
  emptyText,
  placesHeading,
}: ExploreBrowserProps) {
  const [filter, setFilter] = useState<ExploreFilter>("all");
  const visible =
    filter === "all" ? cards : cards.filter((card) => card.categories.includes(filter));

  return (
    <>
      <FilterBar items={filters} value={filter} onChange={setFilter} label={filterLabel} />

      <section aria-labelledby="explore-places-heading" className="mt-4">
        <h2 id="explore-places-heading" className="sr-only">
          {placesHeading}
        </h2>
        <p aria-live="polite" className="sr-only">
          {countLabels[filter]}
        </p>

        {visible.length > 0 ? (
          <ul className="grid grid-cols-1 gap-2 lg:grid-cols-3 lg:gap-3">
            {visible.map((card, index) => (
              <li key={card.id}>
                <EditorialImageCard
                  href={card.href}
                  title={card.title}
                  subtitle={card.description}
                  ratio={card.featured ? "feature" : "standard"}
                  headingLevel={3}
                  linkComponent={Link}
                  media={
                    <Image
                      src={card.image.src}
                      // Decorative: the card's title names the place.
                      alt=""
                      fill
                      sizes="(min-width: 1024px) 340px, (min-width: 768px) 640px, 100vw"
                      preload={index === 0}
                      placeholder={card.image.blurDataUrl ? "blur" : "empty"}
                      blurDataURL={card.image.blurDataUrl}
                      className="object-cover"
                    />
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          <Text tone="muted" className="py-8">
            {emptyText}
          </Text>
        )}
      </section>
    </>
  );
}
