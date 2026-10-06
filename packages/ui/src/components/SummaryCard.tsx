import { type ReactNode } from "react";

import { Icon } from "../icons/Icon";
import { type IconName } from "../icons/paths";
import { cx } from "../lib/cx";

export type SummaryItem = { id: string; label: string; value: ReactNode };

export type SummaryGroup = { id: string; title?: string; items: readonly SummaryItem[] };

export type SummaryCardProps = {
  title: string;
  icon?: IconName;
  /** e.g. an "Ändern" link – rendered top right. */
  action?: ReactNode;
  groups: readonly SummaryGroup[];
  headingLevel?: 2 | 3;
  className?: string;
};

/**
 * Structured information group: eyebrow title (+ optional action), then label/value
 * pairs in two columns from 360 px on; hairlines only between groups. Used for the
 * check-in review and the trip facts.
 */
export function SummaryCard({
  title,
  icon,
  action,
  groups,
  headingLevel = 2,
  className,
}: SummaryCardProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section className={cx("rounded-card bg-surface p-4 text-text xs:p-5", className)}>
      <div className="flex min-h-6 items-center justify-between gap-4">
        <Heading className="flex items-center gap-3">
          {icon && <Icon name={icon} size="sm" />}
          <span className="type-eyebrow">{title}</span>
        </Heading>
        {action}
      </div>
      <div className="mt-3 flex flex-col divide-y divide-border">
        {groups.map((group) => (
          <div key={group.id} className="py-4 first:pt-0 last:pb-0">
            {group.title && <p className="type-small mb-3 text-text">{group.title}</p>}
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 xs:grid-cols-2">
              {group.items.map((item) => (
                <div key={item.id} className="min-w-0">
                  <dt className="type-caption text-text-muted">{item.label}</dt>
                  <dd className="type-body break-words text-text">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
