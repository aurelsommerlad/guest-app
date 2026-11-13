import "./globals.css";

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { josefinSans, roboto } from "./fonts";

export const metadata: Metadata = {
  title: { default: "UNIQUE PLACES Admin", template: "%s · UNIQUE PLACES Admin" },
  robots: { index: false, follow: false },
  // Installable on the iPhone home screen (ADR 0023: Web Push needs the installed web app).
  appleWebApp: { capable: true, title: "STAY Admin", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#f8f6f1",
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="de" className={`${josefinSans.variable} ${roboto.variable}`}>
      <body className="bg-background text-text">{children}</body>
    </html>
  );
}
