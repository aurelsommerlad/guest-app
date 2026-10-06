"use client";

import { type ExploreCategory, type ExploreFilter } from "@up/core";
import { EditorialImageCard, FilterBar, type FilterBarItem, Icon, Text } from "@up/ui";
import Image from "next/image";
import { useState } from "react";

import { Link } from "../../../i18n/navigation";
import { type ExploreCard } from "../model";

export type ExploreBrowserProps = {
  cards: readonly ExploreCard[];
  /** "all" plus only the categories that have places. */
  filters: readonly FilterBarItem<ExploreFilter>[];
  categoryLabels: Readonly<Record<ExploreCategory, string>>;
  filterLabel: string;
  /** Pre-translated "n recommendations" per filter (announced to screen readers). */
  countLabels: Readonly<Partial<Record<ExploreFilter, string>>>;
  emptyText: string;
  placesHeading: string;
};

/** Category filter + photographic recommendation cards. Filtering happens in the browser. */
export function ExploreBrowser({
  cards,
  filters,
  categoryLabels,
  filterLabel,
  countLabels,
  emptyText,
  placesHeading,
}: ExploreBrowserProps) {
  const [filter, setFilter] = useState<ExploreFilter>("all");
  const visible = filter === "all" ? cards : cards.filter((card) => card.category === filter);
  // A filter with a single category would offer no choice.
  const showFilter = filters.length > 2;

  return (
    <>
      {showFilter && (
        <FilterBar items={filters} value={filter} onChange={setFilter} label={filterLabel} />
      )}

      <section aria-labelledby="explore-places-heading" className={showFilter ? "mt-4" : undefined}>
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
                  eyebrow={[categoryLabels[card.category], card.locality]
                    .filter(Boolean)
                    .join(" · ")}
                  title={card.title}
                  subtitle={card.teaser}
                  ratio={card.featured ? "feature" : "standard"}
                  headingLevel={3}
                  linkComponent={Link}
                  media={
                    card.image ? (
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
                    ) : (
                      // No title image yet: a calm ink panel – never a stand-in photo.
                      <div className="flex size-full items-start justify-end bg-surface-inverse p-5 text-text-inverse">
                        <Icon name="compass" size="lg" />
                      </div>
                    )
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
