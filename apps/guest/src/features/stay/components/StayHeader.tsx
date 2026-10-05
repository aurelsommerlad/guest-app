import { IconButton, PropertyName } from "@up/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import { type StayViewModel } from "../model";

/**
 * Quiet header: UNIQUE PLACES wordmark, property identity, notifications.
 * The wordmark is text until the logo exists as SVG (then it replaces the span).
 */
export async function StayHeader({ property }: { property: StayViewModel["property"] }) {
  const t = await getTranslations();
  return (
    <header className="flex min-h-11 items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <Link
          href="/stay"
          className="type-wordmark inline-flex min-h-11 shrink-0 items-center rounded-sm text-text"
        >
          {t("brand.name")}
        </Link>
        <p className="type-brand min-w-0 truncate">
          <PropertyName name={property.name} spokenName={property.spokenName} />
          <span aria-hidden className="px-1.5 text-text-muted">
            ·
          </span>
          <span className="text-text-muted">{property.location}</span>
        </p>
      </div>
      {/* Notifications follow in a later phase; the action is already in place. */}
      <IconButton icon="bell" label={t("stay.notifications")} variant="ghost" className="-mr-2.5" />
    </header>
  );
}
