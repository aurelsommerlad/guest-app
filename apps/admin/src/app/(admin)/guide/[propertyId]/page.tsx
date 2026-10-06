import { buttonStyles } from "@up/ui";
import { getPropertyById } from "@up/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState, PageHeader } from "../../../../components/PageHeader";
import { requireAdmin } from "../../../../features/auth/server";
import { moveTopicAction } from "../../../../features/guide/actions";
import {
  GuideTopicList,
  type ListedTopic,
} from "../../../../features/guide/components/GuideTopicList";
import { loadPropertyGuide } from "../../../../features/guide/guide-admin-service";
import { guideDeps } from "../../../../features/guide/server";
import {
  filterHref,
  matchesFilter,
  parseTopicFilter,
  topicCounts,
} from "../../../../features/guide/topic-list";
import { getDatabase } from "../../../../server/database";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}): Promise<Metadata> {
  const { propertyId } = await params;
  const admin = await requireAdmin();
  const property = await getPropertyById(getDatabase(), { tenantId: admin.tenantId }, propertyId);
  return { title: property ? `Guide · ${property.displayName}` : "Guide" };
}

type Props = {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ status?: string; archived?: string }>;
};

/** Content list of the property's guide: status tabs, search, topic rows in guest order. */
export default async function GuideTopicsPage({ params, searchParams }: Props) {
  const [{ propertyId }, query] = await Promise.all([params, searchParams]);
  const admin = await requireAdmin();
  const guide = await loadPropertyGuide(guideDeps(), { tenantId: admin.tenantId }, propertyId, {
    includeArchived: true,
  });
  if (!guide) notFound();
  const base = `/guide/${propertyId}`;
  const filter = parseTopicFilter(query);

  // Position = place in the guest view (archived topics have none).
  let position = 0;
  const topics: ListedTopic[] = guide.topics.map((topic) =>
    topic.status === "archived" ? topic : { ...topic, position: ++position },
  );
  const showingArchived = filter === "archived";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Guide"
        description="Themen und Inhalte, die Gäste dieses Objekts in der App sehen – in der Reihenfolge der Gäste-Ansicht."
        actions={
          <>
            <Link
              href={showingArchived ? base : filterHref(base, "archived")}
              className={buttonStyles("secondary")}
            >
              {showingArchived ? "Archivierte ausblenden" : "Archivierte anzeigen"}
            </Link>
            <Link href={`${base}/new`} className={buttonStyles("primary")}>
              Neues Thema
            </Link>
          </>
        }
      />

      {topics.length === 0 ? (
        <EmptyState
          icon="book-open"
          title="Noch keine Guide-Themen"
          description="Lege das erste Thema an, z. B. Anreise, WLAN oder Hausregeln."
          action={
            <Link href={`${base}/new`} className={buttonStyles("primary")}>
              Neues Thema
            </Link>
          }
        />
      ) : (
        <GuideTopicList
          // A fresh list (and search) per property and tab.
          key={`${propertyId}-${filter}`}
          base={base}
          filter={filter}
          counts={topicCounts(topics)}
          topics={topics.filter((topic) => matchesFilter(topic.status, filter))}
          moveAction={moveTopicAction}
          lastPosition={position}
        />
      )}
    </div>
  );
}
