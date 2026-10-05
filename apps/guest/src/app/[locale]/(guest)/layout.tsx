import { type BottomNavigationItem } from "@up/ui";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { GuestBottomNav } from "../../../components/GuestBottomNav";

/** Shell of the guest experience: page content plus the bottom navigation. */
export default async function GuestLayout({ children }: Readonly<{ children: ReactNode }>) {
  const t = await getTranslations("navigation");
  const items: BottomNavigationItem[] = [
    { id: "guide", href: "/guide", label: t("guide"), icon: "map" },
    { id: "stay", href: "/stay", label: t("stay"), icon: "bed" },
    { id: "explore", href: "/explore", label: t("explore"), icon: "compass" },
  ];

  return (
    <>
      <div className="clear-bottom-nav">{children}</div>
      <GuestBottomNav items={items} label={t("label")} />
    </>
  );
}
