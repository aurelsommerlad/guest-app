import Link from "next/link";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EmptyState } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { GuideTopicList, type ListedTopic } from "./components/GuideTopicList";
import {
  filterHref,
  matchesFilter,
  parseTopicFilter,
  searchTopics,
  topicCounts,
  topicMeta,
} from "./topic-list";

function topic(overrides: Partial<ListedTopic> & Pick<ListedTopic, "id">): ListedTopic {
  return {
    key: overrides.id,
    title: { de: "Thema", en: "Topic" },
    shortDescription: { de: "Kurz", en: "Short" },
    status: "published",
    sortOrder: 10,
    scope: { level: "property" },
    overrides: [],
    englishComplete: true,
    hasContent: true,
    icon: "info",
    blockCount: 3,
    ...overrides,
  };
}

const topics: ListedTopic[] = [
  topic({
    id: "arrival",
    position: 1,
    title: { de: "Ankunft & Parken", en: "Arrival & parking" },
    shortDescription: { de: "Anreise und Self-Check-in", en: "Getting here" },
    heroImageSrc: "/fixtures/guide/hov-exterior.webp",
    blockCount: 4,
    icon: "car",
  }),
  topic({
    id: "wifi",
    position: 2,
    title: { de: "WLAN", en: "Wi-Fi" },
    shortDescription: { de: "Netzwerk und Passwort" },
    englishComplete: false,
    icon: "wifi",
    overrides: [{ id: "o1", unitId: "esl", unitName: "ESL", status: "draft" }],
  }),
  topic({
    id: "waste",
    position: 3,
    status: "draft",
    title: { de: "Müll & Recycling" },
    shortDescription: { de: "Trennung und Abholung" },
    hasContent: false,
    blockCount: 0,
    icon: "trash",
    scope: { level: "unit", unitId: "ros", unitName: "ROS" },
  }),
  topic({ id: "old", status: "archived", title: { de: "Alte Hausordnung" } }),
];

describe("topic filters", () => {
  it("parses the status tab from the URL; old ?archived=1 links still work", () => {
    expect(parseTopicFilter({})).toBe("all");
    expect(parseTopicFilter({ status: "draft" })).toBe("draft");
    expect(parseTopicFilter({ status: "published" })).toBe("published");
    expect(parseTopicFilter({ status: "archived" })).toBe("archived");
    expect(parseTopicFilter({ archived: "1" })).toBe("archived");
    expect(parseTopicFilter({ status: "<script>" })).toBe("all");
  });

  it("counts from the real topics; Alle Themen = what guests can get (no archived)", () => {
    expect(topicCounts(topics)).toEqual({ all: 3, published: 2, draft: 1, archived: 1 });
    expect(topicCounts([])).toEqual({ all: 0, published: 0, draft: 0, archived: 0 });
    expect(matchesFilter("archived", "all")).toBe(false);
    expect(filterHref("/guide/hov", "all")).toBe("/guide/hov");
    expect(filterHref("/guide/hov", "draft")).toBe("/guide/hov?status=draft");
  });
});

describe("topic search", () => {
  it("searches title and short description in DE and EN, case- and accent-insensitive", () => {
    const ids = (query: string) => searchTopics(topics, query).map((item) => item.id);
    expect(ids("")).toEqual(["arrival", "wifi", "waste", "old"]);
    expect(ids("wlan")).toEqual(["wifi"]);
    expect(ids("Wi-Fi")).toEqual(["wifi"]);
    expect(ids("passwort")).toEqual(["wifi"]);
    expect(ids("mull")).toEqual(["waste"]);
    expect(ids("getting")).toEqual(["arrival"]);
    expect(ids("anreise check")).toEqual(["arrival"]);
    expect(ids("sauna")).toEqual([]);
  });
});

describe("topic meta", () => {
  it("shows content blocks and languages compactly", () => {
    expect(topicMeta({ blockCount: 4, englishComplete: true, hasContent: true })).toEqual({
      content: "4 Inhalte",
      languages: "DE, EN",
    });
    expect(topicMeta({ blockCount: 1, englishComplete: false, hasContent: true }).content).toBe(
      "1 Inhalt",
    );
    expect(topicMeta({ blockCount: 0, englishComplete: false, hasContent: true }).content).toBe(
      "Nur Einleitung",
    );
    expect(topicMeta({ blockCount: 0, englishComplete: false, hasContent: false })).toEqual({
      content: "Noch ohne Inhalt",
      languages: "DE · EN unvollständig",
    });
  });
});

const move = async () => {
  /* server action stand-in */
};

function list(filter: "all" | "archived" = "all") {
  const shown = topics.filter((item) => matchesFilter(item.status, filter));
  return renderToStaticMarkup(
    <GuideTopicList
      base="/guide/hov"
      filter={filter}
      counts={topicCounts(topics)}
      topics={shown}
      moveAction={move}
      lastPosition={3}
    />,
  );
}

describe("guide content list", () => {
  it("renders compact rows in guest order with number, title image or icon, status and meta", () => {
    const markup = list();
    expect(markup.match(/<li class="group relative/g)).toHaveLength(3);
    expect(markup).toMatch(/>01<\/span>[\s\S]*>02<\/span>[\s\S]*>03<\/span>/);
    // Real title image where it exists, the topic's own icon otherwise (no fake photos).
    expect(markup.match(/<img /g)).toHaveLength(1);
    expect(markup).toContain('src="/fixtures/guide/hov-exterior.webp"');
    expect(markup).toContain('href="/guide/hov/arrival"');
    expect(markup).toMatch(
      /4 Inhalte<\/span><span aria-hidden="true">·<\/span><span class="whitespace-nowrap">DE, EN/,
    );
    expect(markup).toContain(">DE · EN unvollständig<");
    expect(markup).toContain("Noch ohne Inhalt");
    expect(markup).toContain("Varianten: ESL");
    expect(markup).toContain("Nur Apartment ROS");
    expect(markup).not.toContain("Alte Hausordnung");
  });

  it("shows status tabs with real counts and marks the active one", () => {
    const markup = list();
    for (const [label, count] of [
      ["Alle Themen", 3],
      ["Veröffentlicht", 2],
      ["Entwurf", 1],
      ["Archiviert", 1],
    ] as const) {
      expect(markup).toMatch(new RegExp(`${label}<span[^>]*>${String(count)}</span>`));
    }
    expect(markup).toContain('href="/guide/hov?status=draft"');
    const active = [...markup.matchAll(/<a\b[^>]*aria-current="page"[^>]*>/g)].map(
      (match) => /href="([^"]+)"/.exec(match[0])?.[1],
    );
    expect(active).toEqual(["/guide/hov"]);
    expect(markup).toContain('placeholder="Themen durchsuchen …"');
    expect(markup).toContain('role="search"');
  });

  it("offers reordering only in the full list", () => {
    expect(list("all")).toContain("nach oben");
    const archived = list("archived");
    expect(archived).not.toContain("nach oben");
    expect(archived).toContain("Alte Hausordnung");
    expect(archived).toMatch(/>–<\/span>/); // archived topics have no guest position
  });
});

describe("status badges and empty state", () => {
  it("uses quiet tones per status", () => {
    expect(renderToStaticMarkup(<StatusBadge status="published" />)).toContain(
      "bg-status-published text-on-status-published",
    );
    expect(renderToStaticMarkup(<StatusBadge status="draft" />)).toContain("bg-status-draft");
    expect(renderToStaticMarkup(<StatusBadge status="archived" />)).toContain(
      "bg-status-archived text-text-muted",
    );
  });

  it("keeps the empty state compact, with the next step", () => {
    const markup = renderToStaticMarkup(
      <EmptyState
        icon="book-open"
        title="Noch keine Guide-Themen"
        description="Lege das erste Thema an."
        action={<Link href="/guide/hov/new">Neues Thema</Link>}
      />,
    );
    expect(markup).toContain("max-w-128");
    expect(markup).toContain("Noch keine Guide-Themen");
    expect(markup).toContain('href="/guide/hov/new"');
  });
});
