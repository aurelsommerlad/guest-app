import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

// Placeholder shell for Phase 0. Fonts, design tokens and i18n (next-intl)
// are introduced in Phase 1/2; the `lang` attribute then follows the locale.
export const metadata: Metadata = {
  title: "UNIQUE PLACES",
  // Guest pages contain personal stay information and must never be indexed.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
