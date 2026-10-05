import { type ComponentPropsWithoutRef, type ElementType, type ReactNode } from "react";

import { cx } from "../lib/cx";

export const surfaceTones = {
  /** Linen card – the default tile/card surface (token: card). */
  card: "bg-surface text-text",
  /** Chalk white – list cards, elevated content on sand. */
  raised: "bg-surface-raised text-text",
  /** Sage – the characteristic accent area, with AA-compliant on-accent text. */
  accent: "bg-surface-accent text-on-accent",
  /** Ink – rare, high-emphasis surfaces. */
  inverse: "bg-surface-inverse text-text-inverse",
  /** No fill, hairline border. */
  outline: "bg-transparent text-text border border-border",
} as const;

const paddings = {
  none: "",
  sm: "p-3",
  md: "p-4", // reference tile/card padding: 16px
  lg: "p-6",
} as const;

export type SurfaceTone = keyof typeof surfaceTones;

export type SurfaceProps = {
  as?: "div" | "section" | "article" | "aside" | "li" | "figure";
  tone?: SurfaceTone;
  padding?: keyof typeof paddings;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"div">, "children">;

/**
 * Basic card surface. Flat by design: the reference uses tone, not shadows,
 * to separate surfaces from the background.
 */
export function Surface({
  as = "div",
  tone = "card",
  padding = "md",
  className,
  children,
  ...rest
}: SurfaceProps) {
  const Component = as as ElementType;
  return (
    <Component
      className={cx("rounded-card", surfaceTones[tone], paddings[padding], className)}
      {...rest}
    >
      {children}
    </Component>
  );
}
