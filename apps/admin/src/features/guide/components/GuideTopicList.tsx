"use client";

import { cx, Icon, type IconName } from "@up/ui";
import Link from "next/link";
import { useId, useState } from "react";

import { StatusBadge } from "../../../components/StatusBadge";
import type { TopicSummary } from "../guide-admin-service";
import {
  filterHref,
  searchTopics,
  TOPIC_FILTER_LABELS,
  TOPIC_FILTERS,
  type TopicFilter,
  topicMeta,
} from "../topic-list";

export type ListedTopic = TopicSummary & {
  /** Position in the guest view (1-based); undefined for archived topics. */
  position?: number;
};

type Props = {
  base: string;
  filter: TopicFilter;
  counts: Record<TopicFilter, number>;
  topics: readonly ListedTopic[];
  /** Reordering is offered in the full list without a search only. */
  moveAction?: (topicId: string, direction: "up" | "down") => Promise<void>;
  lastPosition: number;
};

/** Content list of a property's guide: status tabs, local search and topic rows. */
export function GuideTopicList({ base, filter, counts, topics, moveAction, lastPosition }: Props) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const visible = searchTopics(topics, query);
  const sortable = moveAction !== undefined && filter === "all" && query.trim() === "";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 border-b border-border md:flex-row md:items-end md:justify-between">
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
                    {TOPIC_FILTER_LABELS[item]}
                    <span className="type-caption rounded-full bg-surface px-2 py-0.5 tabular-nums">
                      {counts[item]}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div role="search" className="relative mb-3 md:w-72">
          <label htmlFor={searchId} className="sr-only">
            Themen durchsuchen
          </label>
          <Icon
            name="search"
            size="sm"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-muted"
          />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Themen durchsuchen …"
            className="type-small min-h-11 w-full rounded-control border border-border bg-surface-raised pr-3 pl-9 text-text placeholder:text-text-muted"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <p role="status" className="type-small py-6 text-text-muted">
          {query.trim()
            ? `Keine Themen zu „${query.trim()}“.`
            : `Keine Themen mit dem Status „${TOPIC_FILTER_LABELS[filter]}“.`}
        </p>
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Guide-Themen">
          {visible.map((topic) => (
            <TopicRow
              key={topic.id}
              topic={topic}
              href={`${base}/${topic.id}`}
              moveAction={sortable ? moveAction : undefined}
              lastPosition={lastPosition}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function Thumbnail({ src, icon }: { src?: string; icon: IconName }) {
  return (
    <span className="flex aspect-landscape w-20 shrink-0 items-center justify-center overflow-hidden rounded-control bg-surface text-text-muted md:w-28">
      {src ? (
        // Admin thumbnail of the topic's own title image (storage or local fixture).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <Icon name={icon} size="lg" />
      )}
    </span>
  );
}

function Meta({ topic, className }: { topic: ListedTopic; className?: string }) {
  const meta = topicMeta(topic);
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <div>
        <StatusBadge status={topic.status} />
      </div>
      <p className="type-caption flex flex-wrap gap-x-1.5 text-text-muted">
        <span className="whitespace-nowrap">{meta.content}</span>
        <span aria-hidden>·</span>
        <span className="whitespace-nowrap">{meta.languages}</span>
      </p>
    </div>
  );
}

function TopicRow({
  topic,
  href,
  moveAction,
  lastPosition,
}: {
  topic: ListedTopic;
  href: string;
  moveAction?: Props["moveAction"];
  lastPosition: number;
}) {
  const title = topic.title.de ?? topic.key;
  const details = [
    topic.scope.level === "unit" ? `Nur Apartment ${topic.scope.unitName}` : undefined,
    topic.overrides.length > 0
      ? `Varianten: ${topic.overrides.map((override) => override.unitName).join(", ")}`
      : undefined,
  ].filter(Boolean);

  return (
    <li className="group relative flex items-center gap-3 rounded-card border border-border bg-surface-raised p-3 transition-colors hover:border-text-muted/50 md:gap-5 md:pr-4">
      <span className="type-caption hidden w-6 shrink-0 text-text-muted tabular-nums md:block">
        {topic.position !== undefined ? String(topic.position).padStart(2, "0") : "–"}
      </span>
      <Thumbnail src={topic.heroImageSrc} icon={topic.icon} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          href={href}
          className="type-title truncate rounded-sm text-text after:absolute after:inset-0 after:rounded-card"
        >
          {title}
        </Link>
        {topic.shortDescription.de && (
          <p className="type-small line-clamp-2 text-text-muted">{topic.shortDescription.de}</p>
        )}
        {details.length > 0 && (
          <p className="type-caption text-text-muted">{details.join(" · ")}</p>
        )}
        <Meta topic={topic} className="pt-1 md:hidden" />
      </div>
      <Meta topic={topic} className="hidden w-52 shrink-0 md:flex lg:w-64" />
      {moveAction && topic.position !== undefined && (
        <div className="relative z-10 flex flex-col" aria-label="Reihenfolge">
          <form action={moveAction.bind(null, topic.id, "up")}>
            <button
              type="submit"
              aria-label={`${title} nach oben`}
              disabled={topic.position === 1}
              className="flex size-9 items-center justify-center rounded-control text-text-muted hover:bg-surface hover:text-text disabled:opacity-30"
            >
              <Icon name="chevron-down" size="sm" className="rotate-180" />
            </button>
          </form>
          <form action={moveAction.bind(null, topic.id, "down")}>
            <button
              type="submit"
              aria-label={`${title} nach unten`}
              disabled={topic.position === lastPosition}
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
