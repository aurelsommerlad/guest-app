import { type ComponentPropsWithoutRef, type ElementType, type ReactNode } from "react";

import { cx } from "../lib/cx";

/**
 * Allowed gaps (4px grid). Reference rhythm: 8px between siblings of a group
 * (tiles, photo cards), 12px between groups, 20–40px between sections.
 */
const gaps = {
  0: "gap-0",
  1: "gap-1",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
  5: "gap-5",
  6: "gap-6",
  8: "gap-8",
  10: "gap-10",
  12: "gap-12",
  16: "gap-16",
  20: "gap-20",
} as const;

const aligns = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
  baseline: "items-baseline",
} as const;

const justifies = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
} as const;

export type StackGap = keyof typeof gaps;

export type StackProps = {
  as?: "div" | "section" | "ul" | "ol" | "header" | "footer" | "nav" | "article";
  direction?: "vertical" | "horizontal";
  gap?: StackGap;
  align?: keyof typeof aligns;
  justify?: keyof typeof justifies;
  wrap?: boolean;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"div">, "children">;

/** One-dimensional layout with token-based gaps. */
export function Stack({
  as = "div",
  direction = "vertical",
  gap = 4,
  align,
  justify,
  wrap = false,
  className,
  children,
  ...rest
}: StackProps) {
  const Component = as as ElementType;
  return (
    <Component
      className={cx(
        "flex",
        direction === "vertical" ? "flex-col" : "flex-row",
        gaps[gap],
        align && aligns[align],
        justify && justifies[justify],
        wrap && "flex-wrap",
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
