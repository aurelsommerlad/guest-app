import { type ReactNode } from "react";

import { Icon } from "../icons/Icon";
import { type IconName } from "../icons/paths";
import { cx } from "../lib/cx";

const tones = {
  /** Warm linen tile (e.g. check-out). */
  card: { surface: "bg-surface text-text", meta: "text-text-muted" },
  /** Characteristic sage tile (e.g. apartment). */
  accent: { surface: "bg-surface-accent text-on-accent", meta: "text-on-accent" },
} as const;

export type InfoTileTone = keyof typeof tones;

export type InfoTileProps = {
  icon: IconName;
  /** Short label, rendered as uppercase eyebrow (e.g. "Check-out"). */
  label: string;
  /** Key information (e.g. "10:00", "ROS"). */
  value: ReactNode;
  /** `figure` for short key figures, `text` for short phrases ("Jetzt erledigen"). */
  valueStyle?: "figure" | "text";
  /** Secondary line or a link (e.g. date, "Details ansehen →"). */
  meta?: ReactNode;
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
  tone = "card",
  className,
}: InfoTileProps) {
  const colors = tones[tone];
  return (
    <div
      className={cx(
        "relative flex flex-col gap-4 rounded-card p-3 pb-2.5 xs:p-4 xs:pb-3",
        colors.surface,
        className,
      )}
    >
      <dt className="flex items-center gap-3 xs:gap-4">
        <Icon name={icon} size="sm" />
        <span className="type-eyebrow">{label}</span>
      </dt>
      <dd className="flex flex-col gap-1">
        <span className={valueStyle === "figure" ? "type-figure" : "type-title"}>{value}</span>
        {meta && <span className={cx("type-small", colors.meta)}>{meta}</span>}
      </dd>
    </div>
  );
}
