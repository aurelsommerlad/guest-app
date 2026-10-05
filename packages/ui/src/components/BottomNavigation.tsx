import { Icon } from "../icons/Icon";
import { type IconName } from "../icons/paths";
import { cx } from "../lib/cx";
import { type LinkComponent } from "./link";

export type BottomNavigationItem = {
  id: string;
  href: string;
  label: string;
  icon: IconName;
};

export type BottomNavigationProps = {
  items: readonly BottomNavigationItem[];
  /** Id of the active item. The circular highlight follows it to any position. */
  activeId?: string;
  /** Accessible name of the navigation landmark. */
  label: string;
  linkComponent?: LinkComponent;
  className?: string;
};

/**
 * Mobile bottom navigation. The active item is shown inside an ink circle
 * (reference: STAY); every item can carry it, so it is not tied to a position.
 * Keeps clear of the home indicator via the safe-area inset.
 */
export function BottomNavigation({
  items,
  activeId,
  label,
  linkComponent: Link = "a",
  className,
}: BottomNavigationProps) {
  return (
    <nav
      aria-label={label}
      className={cx("border-t border-border bg-background safe-bottom", className)}
    >
      <ul className="mx-auto flex h-nav-bar max-w-nav items-center">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <li key={item.id} className="flex flex-1 justify-center">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex size-nav-active flex-col items-center justify-center rounded-full transition-colors duration-250 ease-standard",
                  active
                    ? "gap-1 bg-surface-inverse text-text-inverse"
                    : "gap-2 text-text hover:bg-surface",
                )}
              >
                <Icon name={item.icon} size={active ? "lg" : "md"} />
                <span className="type-nav">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
