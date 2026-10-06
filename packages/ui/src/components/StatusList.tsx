import { type ReactNode } from "react";

import { Icon } from "../icons/Icon";
import { cx } from "../lib/cx";

export type StatusListItem = {
  id: string;
  label: ReactNode;
  /** done: filled check · open: empty circle */
  state: "done" | "open";
};

export type StatusListProps = {
  items: readonly StatusListItem[];
  /** Screen-reader words for the states, e.g. { done: "erledigt", open: "offen" }. */
  stateLabels: Record<StatusListItem["state"], string>;
  /** `row` wraps items side by side (compact progress), `column` stacks them. */
  layout?: "row" | "column";
  className?: string;
};

/** Small checklist of steps or facts with a done/open mark. */
export function StatusList({ items, stateLabels, layout = "column", className }: StatusListProps) {
  return (
    <ul
      className={cx(
        layout === "row" ? "flex flex-wrap gap-x-5 gap-y-2" : "flex flex-col gap-2.5",
        className,
      )}
    >
      {items.map((item) => (
        <li key={item.id} className="type-small flex items-center gap-2.5 text-text">
          <span
            aria-hidden
            className={cx(
              "flex size-5 shrink-0 items-center justify-center rounded-full",
              item.state === "done"
                ? "bg-success text-on-success"
                : "border border-text-muted bg-transparent",
            )}
          >
            {item.state === "done" && <Icon name="check" size="xs" />}
          </span>
          <span className="min-w-0">
            {item.label}
            <span className="sr-only"> ({stateLabels[item.state]})</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
