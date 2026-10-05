import type { Metadata, Viewport } from "next";

/** Shared by all root layouts (locale routes, Design Lab). */
export const documentMetadata: Metadata = {
  title: { default: "UNIQUE PLACES", template: "%s · UNIQUE PLACES" },
  // Guest pages contain personal stay information and must never be indexed.
  robots: { index: false, follow: false },
};

export const documentViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Use the full screen; safe-area insets are handled in the layout (safe-top/safe-bottom).
  viewportFit: "cover",
};
