import { type SVGProps } from "react";

import { cx } from "../lib/cx";
import { iconPaths, type IconName } from "./paths";

/**
 * Icon box sizes. The glyph fills ~75–85% of the box, so a 16px box shows
 * a ~12–14px glyph as in the reference tiles.
 */
export const iconSizes = { xs: 12, sm: 16, md: 20, lg: 24 } as const;
export type IconSize = keyof typeof iconSizes;

export type IconProps = {
  name: IconName;
  size?: IconSize;
  /**
   * Accessible name. Omit for decorative icons (next to visible text) –
   * they are then hidden from assistive technology.
   */
  label?: string;
} & Omit<SVGProps<SVGSVGElement>, "name" | "children">;

/** Thin outline icon in currentColor. */
export function Icon({ name, size = "md", label, className, ...rest }: IconProps) {
  const px = iconSizes[size];
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      className={cx("shrink-0", className)}
      {...a11y}
      {...rest}
    >
      {iconPaths[name]}
    </svg>
  );
}
