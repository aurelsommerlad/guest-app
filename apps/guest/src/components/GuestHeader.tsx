import { Icon, IconButton, PropertyName } from "@up/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "../i18n/navigation";

export type HeaderProperty = { name: string; spokenName: string; location: string };

/**
 * Quiet app header: UNIQUE PLACES wordmark, property identity, notifications.
 * Used on section start pages (STAY, GUIDE). The wordmark is text until the
 * logo exists as SVG (then it replaces the link content).
 */
export async function BrandHeader({ property }: { property: HeaderProperty }) {
  const t = await getTranslations("header");
  return (
    <header className="flex min-h-11 items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <Link
          href="/stay"
          className="type-wordmark inline-flex min-h-11 shrink-0 items-center rounded-sm text-text"
        >
          {t("brand")}
        </Link>
        <p className="type-brand min-w-0 truncate">
          <PropertyName name={property.name} spokenName={property.spokenName} />
          <span aria-hidden className="px-1.5 text-text-muted">
            ·
          </span>
          <span className="text-text-muted">{property.location}</span>
        </p>
      </div>
      <NotificationsButton label={t("notifications")} />
    </header>
  );
}

/**
 * Header of detail pages: a labelled way back (e.g. "Guide") and notifications.
 * The property is already known from the stay, so it is not repeated here.
 */
export async function BackHeader({ href, label }: { href: string; label: string }) {
  const t = await getTranslations("header");
  return (
    <header className="flex min-h-11 items-center justify-between gap-4">
      <Link
        href={href}
        className="type-small -ml-1 inline-flex min-h-11 items-center gap-2 rounded-sm px-1 text-text underline-offset-4 hover:underline"
      >
        <Icon name="arrow-left" size="md" />
        <span>
          <span className="sr-only">{t("backTo")} </span>
          {label}
        </span>
      </Link>
      <NotificationsButton label={t("notifications")} />
    </header>
  );
}

/* Notifications follow in a later phase; the action is already in place. */
function NotificationsButton({ label }: { label: string }) {
  return <IconButton icon="bell" label={label} variant="ghost" className="-mr-2.5" />;
}
