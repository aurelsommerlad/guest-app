"use client";

import { BottomNavigation, type BottomNavigationItem } from "@up/ui";

import { Link, usePathname } from "../i18n/navigation";

/**
 * App-wide bottom navigation. The active item follows the current section,
 * so the circular highlight moves with it (GUIDE · STAY · EXPLORE).
 */
export function GuestBottomNav({
  items,
  label,
}: {
  items: readonly BottomNavigationItem[];
  label: string;
}) {
  const pathname = usePathname(); // without locale prefix, e.g. "/stay"
  const section = pathname.split("/")[1];
  const activeId = items.find((item) => item.id === section)?.id;

  return (
    <BottomNavigation
      items={items}
      activeId={activeId}
      label={label}
      linkComponent={Link}
      className="fixed inset-x-0 bottom-0 z-10"
    />
  );
}
