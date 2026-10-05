import { cx } from "../lib/cx";

export type FilterBarItem<T extends string> = { id: T; label: string };

export type FilterBarProps<T extends string> = {
  items: readonly FilterBarItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the filter group, e.g. "Kategorien". */
  label: string;
  className?: string;
};

/**
 * Quiet text filter (uppercase labels, the active one underlined) – deliberately
 * no chips. Scrolls horizontally on narrow screens. Render inside a client component.
 */
export function FilterBar<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: FilterBarProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx(
        "scrollbar-hidden -mx-gutter overflow-x-auto px-gutter md:-mx-gutter-md md:px-gutter-md lg:mx-0 lg:px-0",
        className,
      )}
    >
      <ul className="flex gap-6">
        {items.map((item) => {
          const active = item.id === value;
          return (
            <li key={item.id} className="shrink-0">
              <button
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onChange(item.id);
                }}
                className={cx(
                  "type-eyebrow inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm whitespace-nowrap transition-colors duration-150",
                  active
                    ? "text-text underline decoration-1 underline-offset-8"
                    : "text-text-muted hover:text-text",
                )}
              >
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
