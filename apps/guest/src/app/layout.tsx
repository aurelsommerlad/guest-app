import "./globals.css";

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { josefinSans, roboto } from "./fonts";

// The `lang` attribute follows the active locale once i18n (next-intl) is introduced.
export const metadata: Metadata = {
  title: "UNIQUE PLACES",
  // Guest pages contain personal stay information and must never be indexed.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="de" className={`${josefinSans.variable} ${roboto.variable}`}>
      <body>{children}</body>
    </html>
  );
}
