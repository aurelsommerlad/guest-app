import { type ComponentPropsWithoutRef, type ElementType, type ReactNode } from "react";

import { cx } from "../lib/cx";

const widths = {
  reading: "max-w-reading",
  content: "max-w-content",
  wide: "max-w-wide",
  full: "",
} as const;

export type ContainerWidth = keyof typeof widths;

export type ContainerProps = {
  as?: "div" | "section" | "main" | "header" | "footer" | "article" | "nav";
  width?: ContainerWidth;
  /** Apply the responsive page gutter (20 → 32 → 48px). */
  gutter?: boolean;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"div">, "children">;

/** Horizontally centers content and applies the page gutter. */
export function Container({
  as = "div",
  width = "content",
  gutter = true,
  className,
  children,
  ...rest
}: ContainerProps) {
  const Component = as as ElementType;
  return (
    <Component
      className={cx(
        "mx-auto w-full",
        widths[width],
        gutter && "px-gutter md:px-gutter-md lg:px-gutter-lg",
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
