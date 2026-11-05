"use client";

import { Icon, type IconName } from "@up/ui";

import { Link, usePathname } from "../../i18n/navigation";

export type V2NavItem = { id: "guide" | "stay" | "explore"; href: string; label: string };

const ICONS: Record<V2NavItem["id"], IconName> = { guide: "map", stay: "bed", explore: "compass" };

/**
 * V2 bottom navigation: outline icons, tracked labels, the active item in a black circle
 * with its label below. Everything under /v2 belongs to STAY.
 */
export function V2BottomNav({ items, label }: { items: readonly V2NavItem[]; label: string }) {
  const pathname = usePathname();
  const active: V2NavItem["id"] | undefined = pathname.startsWith("/v2")
    ? "stay"
    : (items.find((item) => pathname.startsWith(item.href))?.id ?? undefined);
  return (
    <nav aria-label={label} className="v2-nav">
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <Link href={item.href} aria-current={item.id === active ? "page" : undefined}>
              <span className="v2-nav-icon">
                <Icon name={ICONS[item.id]} />
              </span>
              <span className="v2-nav-label">{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
