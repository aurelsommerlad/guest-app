import { Heading, Icon, type IconName, Text } from "@up/ui";
import Link from "next/link";
import type { ReactNode } from "react";

export type Crumb = { label: string; href: string };

/**
 * Parent pages only – the current page is the heading. The property is not repeated: the
 * global selector already shows it.
 */
export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Pfad">
      <ol className="type-small flex flex-wrap items-center gap-x-2 gap-y-1 text-text-muted">
        {items.map((item, index) => (
          <li key={item.href} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden>/</span>}
            <Link href={item.href} className="rounded-sm hover:text-text hover:underline">
              {item.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Page title with optional path, eyebrow, description, status and actions. */
export function PageHeader({
  title,
  breadcrumbs = [],
  eyebrow,
  description,
  status,
  actions,
}: {
  title: ReactNode;
  breadcrumbs?: readonly Crumb[];
  eyebrow?: string;
  description?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4">
      <Breadcrumbs items={breadcrumbs} />
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-2">
          {eyebrow && (
            <Text variant="eyebrow" tone="muted">
              {eyebrow}
            </Text>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Heading level={1} variant="title-lg">
              {title}
            </Heading>
            {status}
          </div>
          {description && (
            <Text variant="small" tone="muted" className="max-w-168">
              {description}
            </Text>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Heading of a section within a page. */
export function SectionHeader({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h2 id={id} className="type-title text-text">
        {title}
      </h2>
      {description && (
        <Text variant="small" tone="muted" className="max-w-168">
          {description}
        </Text>
      )}
    </div>
  );
}

/** Calm, compact empty state: what is missing and – if possible – the next step. */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="flex max-w-128 flex-col items-start gap-4 rounded-card border border-border bg-surface-raised p-6 md:p-8">
      {icon && (
        <span className="flex size-12 items-center justify-center rounded-full bg-surface text-text-muted">
          <Icon name={icon} size="lg" />
        </span>
      )}
      <div className="flex flex-col gap-1.5">
        <p className="type-title text-text">{title}</p>
        {description && (
          <Text variant="small" tone="muted">
            {description}
          </Text>
        )}
      </div>
      {action}
    </div>
  );
}
