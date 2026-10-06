import { Icon } from "@up/ui";
import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import { type StaySummary } from "../model";

/** Compact reservation card: photo, "HØV · ROS", dates, travellers – links to the apartment. */
export async function StaySummaryCard({ summary }: { summary: StaySummary }) {
  const t = await getTranslations("stay.summary");
  return (
    <section aria-label={t("label")}>
      <Link
        href={summary.href}
        className="group flex min-h-24 overflow-hidden rounded-card border border-border bg-surface-raised text-text transition-colors duration-150 hover:bg-surface"
      >
        {summary.image && (
          <span className="relative w-28 shrink-0 xs:w-32">
            <Image
              src={summary.image.src}
              alt=""
              fill
              sizes="128px"
              className="object-cover"
              style={summary.image.focus ? { objectPosition: summary.image.focus } : undefined}
            />
          </span>
        )}
        <span className="flex min-w-0 flex-1 items-center gap-3 p-4">
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="type-title">{summary.title}</span>
            <span className="type-small text-text-muted">{summary.dates}</span>
            {summary.travellers && (
              <span className="type-small text-text-muted">
                {t("travellersTotal", { count: summary.travellers.total })}
              </span>
            )}
          </span>
          <Icon
            name="chevron-right"
            size="md"
            className="shrink-0 text-text-muted transition-transform duration-150 motion-safe:group-hover:translate-x-0.5"
          />
          <span className="sr-only">{t("details")}</span>
        </span>
      </Link>
    </section>
  );
}
