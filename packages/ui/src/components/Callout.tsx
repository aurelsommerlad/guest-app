import { type ReactNode } from "react";

import { Icon } from "../icons/Icon";
import { type IconName } from "../icons/paths";
import { cx } from "../lib/cx";

export type CalloutProps = {
  /** Short label, rendered as eyebrow (e.g. "Gut zu wissen"). */
  title?: string;
  icon?: IconName;
  children: ReactNode;
  className?: string;
};

/** Quiet hint surface ("Gut zu wissen") on the linen card tone. */
export function Callout({ title, icon = "lightbulb", children, className }: CalloutProps) {
  return (
    <aside className={cx("flex gap-3 rounded-card bg-surface p-4 text-text", className)}>
      <Icon name={icon} size="md" className="mt-px" />
      <div className="min-w-0 flex-1">
        {title && <p className="type-eyebrow mb-1.5 leading-5">{title}</p>}
        <div className="type-small">{children}</div>
      </div>
    </aside>
  );
}
