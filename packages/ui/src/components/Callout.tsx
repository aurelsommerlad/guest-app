import { type ReactNode } from "react";

import { Icon } from "../icons/Icon";
import { type IconName } from "../icons/paths";
import { cx } from "../lib/cx";

export type CalloutProps = {
  /** Short label, rendered as eyebrow (e.g. "Gut zu wissen"). */
  title?: string;
  icon?: IconName;
  /** `surface` (linen, default) or `sage` for status notices in the guest journey. */
  tone?: "surface" | "sage";
  children: ReactNode;
  className?: string;
};

/** Quiet hint surface ("Gut zu wissen") on the linen card tone. */
export function Callout({
  title,
  icon = "lightbulb",
  tone = "surface",
  children,
  className,
}: CalloutProps) {
  return (
    <aside
      className={cx(
        "flex gap-3 rounded-card p-4 text-text",
        tone === "sage" ? "bg-surface-sage" : "bg-surface",
        className,
      )}
    >
      <Icon name={icon} size="md" className="mt-px" />
      <div className="min-w-0 flex-1">
        {title && <p className="type-eyebrow mb-1.5 leading-5">{title}</p>}
        <div className="type-small">{children}</div>
      </div>
    </aside>
  );
}
