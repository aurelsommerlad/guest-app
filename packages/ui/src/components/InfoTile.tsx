import { type ReactNode } from "react";

import { Icon } from "../icons/Icon";
import { type IconName } from "../icons/paths";
import { cx } from "../lib/cx";
import { type LinkComponent } from "./link";

const tones = {
  /** Warm linen tile (e.g. check-out). */
  card: { surface: "bg-surface text-text", meta: "text-text-muted" },
  /**
   * Characteristic sage tile (e.g. apartment, online check-in) – light text as in the STAY
   * reference (chalk on sage ≈ 2.8:1: decided by design, Phase 11.4; see design-system.md).
   */
  accent: { surface: "bg-surface-accent text-text-inverse", meta: "text-text-inverse" },
} as const;

const valueStyles = {
  /** Short key figures ("10:00", "ROS"). */
  figure: "type-figure",
  /** Short statements ("Fast geschafft.", "12.–14. Jan."). */
  statement: "type-statement",
  /** Short phrases in card size ("Jetzt erledigen"). */
  text: "type-title",
} as const;

export type InfoTileTone = keyof typeof tones;

export type InfoTileProps = {
  icon: IconName;
  /** Short label, rendered as uppercase eyebrow (e.g. "Check-out"). */
  label: string;
  /** Key information (e.g. "10:00", "ROS"). */
  value: ReactNode;
  valueStyle?: keyof typeof valueStyles;
  /** Secondary line or a link (e.g. date, "Details ansehen →"). */
  meta?: ReactNode;
  /** Bottom of the tile, e.g. a compact progress bar. Decorative or self-labelled. */
  footer?: ReactNode;
  /**
   * Makes the whole tile one link (stretched over the tile). `linkLabel` is its accessible
   * name; the visible texts stay as they are.
   */
  href?: string;
  linkLabel?: string;
  linkComponent?: LinkComponent;
  tone?: InfoTileTone;
  className?: string;
};

/**
 * Editorial information surface: label, one key value, one supporting line.
 * Renders as a description-list group – place it inside a <dl>.
 */
export function InfoTile({
  icon,
  label,
  value,
  valueStyle = "figure",
  meta,
  footer,
  href,
  linkLabel,
  linkComponent: Link = "a",
  tone = "card",
  className,
}: InfoTileProps) {
  const colors = tones[tone];
  return (
    <div
      className={cx(
        "relative flex flex-col gap-3 rounded-card p-4 pb-3.5 lg:p-5 lg:pb-4",
        href && "transition duration-150 hover:brightness-97",
        colors.surface,
        className,
      )}
    >
      <dt className="flex items-center gap-3.5">
        <Icon name={icon} size="sm" />
        <span className="type-eyebrow">{label}</span>
      </dt>
      <dd className="flex flex-1 flex-col gap-2">
        <span className={valueStyles[valueStyle]}>{value}</span>
        {meta && <span className={cx("type-caption", colors.meta)}>{meta}</span>}
        {footer && <span className="mt-auto block pt-2">{footer}</span>}
        {href && (
          <Link href={href} className="absolute inset-0 rounded-card">
            {linkLabel && <span className="sr-only">{linkLabel}</span>}
          </Link>
        )}
      </dd>
    </div>
  );
}
