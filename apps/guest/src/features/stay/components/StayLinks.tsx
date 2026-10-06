import { Icon, type IconName } from "@up/ui";

import { Link } from "../../../i18n/navigation";
import { type StayCard } from "../model";

const ICONS: Record<StayCard["id"], IconName> = {
  guide: "home",
  extras: "shopping-bag",
  explore: "mountain",
};

/** Compact, calm navigation cards for phones (desktop keeps the photo cards). */
export function StayLinks({ cards, heading }: { cards: readonly StayCard[]; heading: string }) {
  return (
    <section aria-labelledby="stay-links-heading">
      <h2 id="stay-links-heading" className="sr-only">
        {heading}
      </h2>
      <ul className="flex flex-col gap-2">
        {cards.map((card) => (
          <li key={card.id}>
            <Link
              href={card.href}
              className="group flex min-h-18 items-center gap-4 rounded-card border border-border bg-surface-raised px-4 py-3.5 text-text transition-colors duration-150 hover:bg-surface"
            >
              <Icon name={ICONS[card.id]} size="lg" className="shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="type-title">{card.title}</span>
                <span className="type-caption text-text-muted">{card.subtitle}</span>
              </span>
              <Icon
                name="chevron-right"
                size="md"
                className="shrink-0 text-text-muted transition-transform duration-150 motion-safe:group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
