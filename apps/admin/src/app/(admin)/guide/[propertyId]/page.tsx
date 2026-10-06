import { buttonStyles } from "@up/ui";
import { getPropertyById } from "@up/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState, PageHeader } from "../../../../components/PageHeader";
import { StatusBadge } from "../../../../components/StatusBadge";
import { requireAdmin } from "../../../../features/auth/server";
import { moveTopicAction } from "../../../../features/guide/actions";
import { loadPropertyGuide } from "../../../../features/guide/guide-admin-service";
import { guideDeps } from "../../../../features/guide/server";
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
  searchParams: Promise<{ archived?: string }>;
};

/** Topic overview: title, status, order, scope and apartment variants. */
export default async function GuideTopicsPage({ params, searchParams }: Props) {
  const [{ propertyId }, { archived }] = await Promise.all([params, searchParams]);
  const admin = await requireAdmin();
  const showArchived = archived === "1";
  const guide = await loadPropertyGuide(guideDeps(), { tenantId: admin.tenantId }, propertyId, {
    includeArchived: showArchived,
  });
  if (!guide) notFound();
  const base = `/guide/${propertyId}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Guide"
        description="Themen und Inhalte, die Gäste dieses Objekts in der App sehen – in der Reihenfolge der Gäste-Ansicht."
        actions={
          <>
            <Link
              href={showArchived ? base : `${base}?archived=1`}
              className={buttonStyles("secondary")}
            >
              {showArchived ? "Archivierte ausblenden" : "Archivierte anzeigen"}
            </Link>
            <Link href={`${base}/new`} className={buttonStyles("primary")}>
              Neues Thema
            </Link>
          </>
        }
      />

      {guide.topics.length === 0 ? (
        <EmptyState
          title="Noch keine Guide-Themen"
          description="Lege das erste Thema an, z. B. Anreise, WLAN oder Hausregeln."
          action={
            <Link href={`${base}/new`} className={buttonStyles("primary")}>
              Neues Thema
            </Link>
          }
        />
      ) : (
        <ol className="flex flex-col gap-2">
          {guide.topics.map((topic, index) => (
            <li
              key={topic.id}
              className="flex flex-col gap-3 rounded-card bg-surface p-4 md:flex-row md:items-center"
            >
              <div className="flex items-center gap-1" aria-label="Reihenfolge">
                <span className="type-caption w-6 text-text-muted">{index + 1}</span>
                <form action={moveTopicAction.bind(null, topic.id, "up")}>
                  <button
                    type="submit"
                    aria-label={`${topic.title.de ?? ""} nach oben`}
                    disabled={index === 0}
                    className="type-small min-h-9 min-w-9 rounded-control hover:bg-background disabled:opacity-30"
                  >
                    ↑
                  </button>
                </form>
                <form action={moveTopicAction.bind(null, topic.id, "down")}>
                  <button
                    type="submit"
                    aria-label={`${topic.title.de ?? ""} nach unten`}
                    disabled={index === guide.topics.length - 1}
                    className="type-small min-h-9 min-w-9 rounded-control hover:bg-background disabled:opacity-30"
                  >
                    ↓
                  </button>
                </form>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Link
                  href={`${base}/${topic.id}`}
                  className="type-body truncate rounded-sm text-text hover:underline"
                >
                  {topic.title.de}
                </Link>
                <p className="type-caption text-text-muted">
                  {topic.scope.level === "unit"
                    ? `Nur Apartment ${topic.scope.unitName}`
                    : "Gesamtes Objekt"}
                  {topic.overrides.length > 0 &&
                    ` · Varianten: ${topic.overrides.map((item) => item.unitName).join(", ")}`}
                  {!topic.englishComplete && " · Englisch unvollständig"}
                  {!topic.hasContent && " · noch ohne Inhalt"}
                </p>
              </div>
              <div className="self-start md:self-center">
                <StatusBadge status={topic.status} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
