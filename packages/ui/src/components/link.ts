import { type ElementType, type ReactNode } from "react";

/**
 * Minimal props a router link must accept. Lets components render links
 * (next/link, next-intl Link, plain <a>) without depending on a router.
 */
export type LinkComponentProps = {
  href: string;
  className?: string;
  children?: ReactNode;
  "aria-current"?: "page" | undefined;
  "aria-label"?: string;
};

export type LinkComponent = ElementType<LinkComponentProps>;
