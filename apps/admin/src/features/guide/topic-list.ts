import type { GuideStatus } from "@up/core";

import type { TopicSummary } from "./guide-admin-service";

/** Tabs above the topic list. "all" = everything guests can get (draft + published). */
export const TOPIC_FILTERS = ["all", "published", "draft", "archived"] as const;
export type TopicFilter = (typeof TOPIC_FILTERS)[number];

export const TOPIC_FILTER_LABELS: Record<TopicFilter, string> = {
  all: "Alle Themen",
  published: "Veröffentlicht",
  draft: "Entwurf",
  archived: "Archiviert",
};

/** `?status=` → filter; `?archived=1` keeps old links working. Anything else → all. */
export function parseTopicFilter(params: { status?: string; archived?: string }): TopicFilter {
  if (params.archived === "1") return "archived";
  return TOPIC_FILTERS.find((filter) => filter === params.status) ?? "all";
}

export function matchesFilter(status: GuideStatus, filter: TopicFilter): boolean {
  return filter === "all" ? status !== "archived" : status === filter;
}

/** Counts from the loaded topics – never estimated. */
export function topicCounts(
  topics: readonly Pick<TopicSummary, "status">[],
): Record<TopicFilter, number> {
  return Object.fromEntries(
    TOPIC_FILTERS.map((filter) => [
      filter,
      topics.filter((topic) => matchesFilter(topic.status, filter)).length,
    ]),
  ) as Record<TopicFilter, number>;
}

export function filterHref(base: string, filter: TopicFilter): string {
  return filter === "all" ? base : `${base}?status=${filter}`;
}

const normalize = (value: string) =>
  value
    .toLocaleLowerCase("de")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

/** Local search over title and short description (DE and EN). */
export function searchTopics<T extends Pick<TopicSummary, "title" | "shortDescription">>(
  topics: readonly T[],
  query: string,
): T[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...topics];
  return topics.filter((topic) => {
    const haystack = normalize(
      [topic.title.de, topic.title.en, topic.shortDescription.de, topic.shortDescription.en]
        .filter(Boolean)
        .join(" "),
    );
    return terms.every((term) => haystack.includes(term));
  });
}

/** Compact meta line: content blocks and languages. */
export function topicMeta(
  topic: Pick<TopicSummary, "blockCount" | "englishComplete" | "hasContent">,
): {
  content: string;
  languages: string;
} {
  return {
    content:
      topic.blockCount > 0
        ? `${String(topic.blockCount)} ${topic.blockCount === 1 ? "Inhalt" : "Inhalte"}`
        : topic.hasContent
          ? "Nur Einleitung"
          : "Noch ohne Inhalt",
    languages: topic.englishComplete ? "DE, EN" : "DE · EN unvollständig",
  };
}
