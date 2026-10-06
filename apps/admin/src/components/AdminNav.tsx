import { cx, Icon } from "@up/ui";
import Link from "next/link";

import { isModuleActive, moduleHref, visibleNavigation } from "../navigation";

/**
 * Sidebar navigation from the module registry: groups in long-term order, only existing
 * modules. Links carry the active property where the module works per property.
 */
export function AdminNav({
  pathname,
  activePropertyId,
}: {
  pathname: string;
  activePropertyId: string | null;
}) {
  return (
    <nav aria-label="Hauptnavigation" className="flex flex-col gap-6">
      {visibleNavigation().map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          {group.label && (
            <p className="type-eyebrow px-3 pb-1 text-text-muted" id={`nav-${group.id}`}>
              {group.label}
            </p>
          )}
          <ul
            className="flex flex-col gap-0.5"
            aria-labelledby={group.label ? `nav-${group.id}` : undefined}
          >
            {group.modules.map((module) => {
              const active = isModuleActive(module, pathname);
              return (
                <li key={module.id}>
                  <Link
                    href={moduleHref(module, activePropertyId)}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "type-body relative flex min-h-11 items-center gap-3 rounded-control px-3",
                      active
                        ? "bg-surface-raised text-text before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:rounded-full before:bg-action"
                        : "text-text-muted hover:bg-background hover:text-text",
                    )}
                  >
                    <Icon name={module.icon} size="md" />
                    {module.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
