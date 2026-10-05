import { type ReactNode } from "react";

import { Icon } from "../icons/Icon";
import { cx } from "../lib/cx";
import { type LinkComponent } from "./link";

const ratios = {
  /** First, larger card (reference ~2.2 : 1). */
  feature: "aspect-photo-feature lg:aspect-landscape",
  /** Following cards (reference ~2.75 : 1). */
  standard: "aspect-photo lg:aspect-landscape",
} as const;

export type EditorialImageCardProps = {
  href: string;
  title: string;
  subtitle?: string;
  /**
   * The photograph, rendered to fill the card (e.g. next/image with `fill`).
   * Decorative here – the link text names the destination – so pass alt="".
   */
  media: ReactNode;
  ratio?: keyof typeof ratios;
  /** Heading level of the title within the page outline. */
  headingLevel?: 2 | 3;
  linkComponent?: LinkComponent;
  className?: string;
};

/**
 * Large photographic navigation card: photo, title and sub-line bottom left,
 * circular arrow bottom right. The whole card is one link.
 */
export function EditorialImageCard({
  href,
  title,
  subtitle,
  media,
  ratio = "standard",
  headingLevel = 2,
  linkComponent: Link = "a",
  className,
}: EditorialImageCardProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <Link
      href={href}
      className={cx(
        // min-h keeps two-line titles comfortable on compact phones (no effect at 390px).
        "group relative isolate block min-h-32 overflow-hidden rounded-card bg-surface",
        ratios[ratio],
        className,
      )}
    >
      <div className="absolute inset-0 -z-10 transition-transform duration-500 ease-standard motion-safe:group-hover:scale-102">
        {media}
      </div>
      <div aria-hidden className="overlay-image absolute inset-0 -z-10" />
      <div className="flex h-full items-end justify-between gap-4 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <Heading className="type-title text-text-inverse">{title}</Heading>
          {subtitle && (
            <p className="type-small max-w-54 text-balance text-text-inverse">{subtitle}</p>
          )}
        </div>
        <span
          aria-hidden
          className="mb-1 inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-raised text-text transition-colors duration-150 group-hover:bg-background"
        >
          <Icon name="arrow-right" size="md" />
        </span>
      </div>
    </Link>
  );
}
