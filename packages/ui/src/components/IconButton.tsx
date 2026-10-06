import { type ComponentPropsWithoutRef } from "react";

import { Icon, type IconSize } from "../icons/Icon";
import { type IconName } from "../icons/paths";
import { cx } from "../lib/cx";

export const iconButtonVariants = {
  /** Chalk circle on photography (reference: arrow on image cards). */
  raised: "bg-surface-raised text-text hover:bg-background",
  /** Filled call-to-action circle ("+" in Extras) – same token as the primary button. */
  action: "bg-cta text-on-cta hover:bg-cta-hover",
  /** Bare icon, e.g. bell or back arrow in the header. */
  ghost: "bg-transparent text-text hover:bg-surface",
} as const;

const sizes = {
  /** 40px visual circle; the hit area is extended to 44px. */
  md: "size-10",
  /** 32px visual circle (inline add buttons). */
  sm: "size-8",
} as const;

const iconSizeFor: Record<keyof typeof sizes, IconSize> = { md: "md", sm: "sm" };

export type IconButtonVariant = keyof typeof iconButtonVariants;

export type IconButtonProps = {
  icon: IconName;
  /** Required accessible name – an icon-only button has no visible text. */
  label: string;
  variant?: IconButtonVariant;
  size?: keyof typeof sizes;
} & Omit<ComponentPropsWithoutRef<"button">, "children" | "aria-label">;

/** Circular icon-only button with a touch target of at least 44×44px. */
export function iconButtonStyles(
  variant: IconButtonVariant = "raised",
  size: keyof typeof sizes = "md",
  className?: string,
): string {
  return cx(
    "relative inline-flex shrink-0 items-center justify-center rounded-full",
    "transition-colors duration-150 ease-standard",
    // Invisible hit-area extension so small circles still meet the 44px touch target.
    "before:absolute before:top-1/2 before:left-1/2 before:size-touch before:-translate-x-1/2 before:-translate-y-1/2",
    "disabled:pointer-events-none disabled:opacity-40",
    iconButtonVariants[variant],
    sizes[size],
    className,
  );
}

export function IconButton({
  icon,
  label,
  variant = "raised",
  size = "md",
  type = "button",
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={iconButtonStyles(variant, size, className)}
      {...rest}
    >
      <Icon name={icon} size={iconSizeFor[size]} />
    </button>
  );
}
