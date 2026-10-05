import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { josefinSans, roboto } from "./fonts";

export const metadata: Metadata = {
  title: { default: "UNIQUE PLACES Admin", template: "%s · UNIQUE PLACES Admin" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="de" className={`${josefinSans.variable} ${roboto.variable}`}>
      <body className="bg-background text-text">{children}</body>
    </html>
  );
}
