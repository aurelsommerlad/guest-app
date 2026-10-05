import { Icon } from "../icons/Icon";
import { type IconName } from "../icons/paths";
import { cx } from "../lib/cx";
import { type LinkComponent } from "./link";

export type LinkListItem = {
  id: string;
  href: string;
  title: string;
  description?: string;
  icon?: IconName;
};

export type LinkListProps = {
  items: readonly LinkListItem[];
  /** Heading level of the item titles within the page outline. */
  headingLevel?: 2 | 3;
  linkComponent?: LinkComponent;
  className?: string;
};

/**
 * Calm navigation list (guide sections, later apartment topics): outline icon,
 * title, short description, chevron – separated by hairlines, no cards.
 */
export function LinkList({
  items,
  headingLevel = 2,
  linkComponent: Link = "a",
  className,
}: LinkListProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <ul className={cx("border-t border-border", className)}>
      {items.map((item) => (
        <li key={item.id} className="border-b border-border">
          <Link
            href={item.href}
            className="group -mx-2 flex min-h-16 items-center gap-4 rounded-card px-2 py-4 transition-colors duration-150 hover:bg-surface"
          >
            {item.icon && <Icon name={item.icon} size="lg" className="text-text" />}
            <span className="min-w-0 flex-1">
              <Heading className="type-title text-text">{item.title}</Heading>
              {item.description && (
                <span className="type-caption mt-0.5 block text-text-muted">
                  {item.description}
                </span>
              )}
            </span>
            <Icon
              name="chevron-right"
              size="md"
              className="text-text-muted transition-transform duration-150 motion-safe:group-hover:translate-x-0.5"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
