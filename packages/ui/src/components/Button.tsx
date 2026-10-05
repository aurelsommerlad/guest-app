import { type ComponentPropsWithoutRef, type ReactNode } from "react";

import { Icon } from "../icons/Icon";
import { type IconName } from "../icons/paths";
import { cx } from "../lib/cx";

const base =
  "inline-flex items-center justify-center gap-2 select-none whitespace-nowrap " +
  "transition-colors duration-150 ease-standard " +
  "disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40";

export const buttonVariants = {
  /** Filled action – primary-dark for sufficient contrast with chalk text. */
  primary:
    "rounded-control bg-action text-on-action hover:bg-action-hover type-small min-h-11 px-5",
  /** Outline – secondary action next to a primary one. */
  secondary:
    "rounded-control border border-border bg-transparent text-text hover:bg-surface type-small min-h-11 px-5",
  /** Text link with arrow ("Details ansehen →"). Inherits color from its context. */
  link: "rounded-sm text-current type-small underline-offset-4 hover:underline min-h-6",
} as const;

export type ButtonVariant = keyof typeof buttonVariants;

/**
 * Class names of a button. Use with links (e.g. next/link) so that the UI
 * package does not depend on a router: <Link className={buttonStyles("primary")} />.
 */
export function buttonStyles(variant: ButtonVariant = "primary", className?: string): string {
  return cx(base, buttonVariants[variant], className);
}

export type ButtonProps = {
  variant?: ButtonVariant;
  /** Icon after the label, e.g. "arrow-right" for forward actions. */
  iconEnd?: IconName;
  iconStart?: IconName;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"button">, "children">;

export function Button({
  variant = "primary",
  iconStart,
  iconEnd,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={buttonStyles(variant, className)} {...rest}>
      {iconStart && <Icon name={iconStart} size="sm" />}
      <span>{children}</span>
      {iconEnd && <Icon name={iconEnd} size="sm" />}
    </button>
  );
}
