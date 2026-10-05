import { type ReactNode } from "react";

import { Icon } from "../icons/Icon";
import { type IconName } from "../icons/paths";
import { cx } from "../lib/cx";

export type DetailListItem = {
  id: string;
  icon: IconName;
  label: string;
  /** Multi-line text keeps its line breaks. */
  value: ReactNode;
};

/** Practical details (opening hours, address …): outline icon, small label, value. */
export function DetailList({
  items,
  className,
}: {
  items: readonly DetailListItem[];
  className?: string;
}) {
  return (
    <dl className={cx("flex flex-col gap-5", className)}>
      {items.map((item) => (
        <div key={item.id} className="flex gap-4">
          <Icon name={item.icon} size="lg" className="text-text" />
          <div className="min-w-0 flex-1">
            <dt className="type-eyebrow leading-6 text-text">{item.label}</dt>
            <dd className="type-body whitespace-pre-line text-text-muted">{item.value}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}
