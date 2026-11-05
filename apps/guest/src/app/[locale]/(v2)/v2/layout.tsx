import "../../../../v2/styles/v2.css";

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { V2BottomNav } from "../../../../v2/components/V2BottomNav";
import { v2Font } from "../../../../v2/fonts";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Design V2 "Editorial" (ADR 0020): a separate shell with its own tokens, typeface and
 * navigation. Same session, data and actions as the current app; nothing of it is shared
 * visually. GUIDE and EXPLORE still lead to the current pages until V2 covers them.
 */
export default async function V2Layout({ children }: Readonly<{ children: ReactNode }>) {
  const t = await getTranslations("navigation");
  return (
    <div className={`v2 ${v2Font.variable}`}>
      {children}
      <V2BottomNav
        label={t("label")}
        items={[
          { id: "guide", href: "/guide", label: t("guide") },
          { id: "stay", href: "/v2", label: t("stay") },
          { id: "explore", href: "/explore", label: t("explore") },
        ]}
      />
    </div>
  );
}
