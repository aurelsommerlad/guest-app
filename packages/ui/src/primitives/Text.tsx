import { type ComponentPropsWithoutRef, type ElementType, type ReactNode } from "react";

import { cx } from "../lib/cx";

export const textVariants = {
  lead: "type-lead",
  body: "type-body",
  small: "type-small",
  caption: "type-caption",
  eyebrow: "type-eyebrow",
  brand: "type-brand",
  nav: "type-nav",
  figure: "type-figure",
} as const;

export const textTones = {
  default: "text-text",
  muted: "text-text-muted",
  inverse: "text-text-inverse",
  action: "text-action",
  inherit: "",
} as const;

export type TextVariant = keyof typeof textVariants;
export type TextTone = keyof typeof textTones;

type TextElement = "p" | "span" | "div" | "strong" | "em" | "small" | "time" | "dd" | "dt" | "li";

export type TextProps = {
  as?: TextElement;
  variant?: TextVariant;
  tone?: TextTone;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"p">, "children">;

/**
 * Running and supporting text. `variant` sets the typographic role,
 * `as` the semantic element – the two are intentionally independent.
 */
export function Text({
  as = "p",
  variant = "body",
  tone = "default",
  className,
  children,
  ...rest
}: TextProps) {
  const Component = as as ElementType;
  return (
    <Component className={cx(textVariants[variant], textTones[tone], className)} {...rest}>
      {children}
    </Component>
  );
}
