import Link from "next/link";
import type { ReactNode } from "react";

import { logoutAction } from "../features/auth/actions";
import { mainNavigation } from "../navigation";

/** Calm two-column shell: brand + main areas on the left, content on the right. */
export function AdminShell({ email, children }: { email: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:flex">
      <aside className="flex shrink-0 flex-col gap-8 border-b border-border px-6 py-6 lg:min-h-dvh lg:w-64 lg:border-r lg:border-b-0 lg:py-10">
        <Link href="/" className="type-wordmark rounded-sm text-text">
          UNIQUE PLACES
          <span className="type-caption block pt-1 text-text-muted normal-case">Admin</span>
        </Link>
        <nav aria-label="Hauptbereiche">
          <ul className="flex gap-2 lg:flex-col">
            {mainNavigation.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="type-small flex min-h-11 items-center rounded-control px-3 text-text hover:bg-surface"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-auto hidden flex-col gap-2 lg:flex">
          <p className="type-caption truncate text-text-muted">{email}</p>
          <form action={logoutAction}>
            <button
              type="submit"
              className="type-small min-h-11 rounded-sm text-text underline-offset-4 hover:underline"
            >
              Abmelden
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-6 py-8 lg:px-12 lg:py-12">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
