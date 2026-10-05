import { type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cx } from "../lib/cx";
import { textTones, type TextTone } from "./Text";

export const headingVariants = {
  display: "type-display",
  "title-lg": "type-title-lg",
  title: "type-title",
} as const;

export type HeadingVariant = keyof typeof headingVariants;
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type HeadingProps = {
  /** Semantic level (document outline). */
  level: HeadingLevel;
  /** Visual style – independent of the level. */
  variant?: HeadingVariant;
  tone?: TextTone;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"h1">, "children">;

const defaultVariant: Record<HeadingLevel, HeadingVariant> = {
  1: "display",
  2: "title-lg",
  3: "title",
  4: "title",
  5: "title",
  6: "title",
};

export function Heading({
  level,
  variant,
  tone = "default",
  className,
  children,
  ...rest
}: HeadingProps) {
  const Tag = `h${level}` as const;
  return (
    <Tag
      className={cx(
        headingVariants[variant ?? defaultVariant[level]],
        textTones[tone],
        "text-balance",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
