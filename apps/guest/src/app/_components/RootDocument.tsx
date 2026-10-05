import "../globals.css";

import type { ReactNode } from "react";

import { josefinSans, roboto } from "../fonts";

/** Shared <html>/<body> shell for every root layout (locale routes, Design Lab, 404). */
export function RootDocument({ lang, children }: { lang: string; children: ReactNode }) {
  return (
    <html lang={lang} className={`${josefinSans.variable} ${roboto.variable}`}>
      <body>{children}</body>
    </html>
  );
}
