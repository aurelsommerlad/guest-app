"use client";

import { Icon, IconButton } from "@up/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";

import { logoutAction } from "../features/auth/actions";
import { type ContextProperty } from "../features/property-context/property-context";
import {
  PropertyContextProvider,
  usePropertyContext,
} from "../features/property-context/PropertyContext";
import { PropertySelector } from "../features/property-context/PropertySelector";
import { AdminNav } from "./AdminNav";

function Brand() {
  return (
    <Link href="/" className="flex flex-col gap-1 self-start rounded-sm">
      <span className="type-wordmark text-text">UNIQUE PLACES</span>
      <span className="type-caption text-text-muted">Admin</span>
    </Link>
  );
}

function SidebarContent({ email }: { email: string }) {
  const pathname = usePathname();
  const { activeId } = usePropertyContext();
  return (
    <div className="flex min-h-full flex-col gap-10">
      <Brand />
      <AdminNav pathname={pathname} activePropertyId={activeId} />
      <div className="mt-auto flex flex-col gap-1 border-t border-border pt-5">
        <p className="type-caption truncate px-3 text-text-muted" title={email}>
          {email}
        </p>
        <form action={logoutAction}>
          <button
            type="submit"
            className="type-small flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-text-muted hover:bg-background hover:text-text"
          >
            <Icon name="log-out" size="md" />
            Abmelden
          </button>
        </form>
      </div>
    </div>
  );
}

/** Mobile/tablet navigation: a modal drawer (native dialog: focus trap, Escape, backdrop). */
function NavigationDrawer({ email }: { email: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    dialog.current?.close();
  }, [pathname]);

  return (
    <>
      <IconButton
        icon="menu"
        label="Navigation öffnen"
        variant="ghost"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      />
      <dialog
        ref={dialog}
        aria-label="Navigation"
        className="m-0 h-dvh max-h-none w-80 max-w-full bg-surface p-0 text-text backdrop:bg-text/30"
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="flex min-h-full flex-col gap-6 px-5 py-6">
          <div className="flex justify-end">
            <IconButton
              icon="x"
              label="Navigation schließen"
              variant="ghost"
              onClick={() => dialog.current?.close()}
            />
          </div>
          <SidebarContent email={email} />
        </div>
      </dialog>
    </>
  );
}

/**
 * Admin shell: fixed sidebar (desktop) or drawer (tablet/mobile), the global context bar
 * with the property selector, and the work area of the current module.
 */
export function AdminShell({
  email,
  properties,
  rememberedPropertyId,
  children,
}: {
  email: string;
  properties: readonly ContextProperty[];
  rememberedPropertyId: string | null;
  children: ReactNode;
}) {
  return (
    <PropertyContextProvider properties={properties} rememberedId={rememberedPropertyId}>
      <a
        href="#main"
        className="type-small sr-only rounded-control bg-surface-raised px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-30"
      >
        Zum Inhalt
      </a>
      <div className="min-h-dvh lg:flex">
        <div className="hidden bg-surface lg:block lg:w-64 lg:shrink-0">
          <aside className="sticky top-0 flex h-dvh flex-col overflow-y-auto px-5 py-8">
            <SidebarContent email={email} />
          </aside>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-16 items-center gap-2 bg-surface px-3 md:px-6 lg:hidden">
            <NavigationDrawer email={email} />
            <Link href="/" className="type-wordmark rounded-sm text-text">
              UNIQUE PLACES
            </Link>
          </header>
          <div className="px-3 pt-4 md:px-6 lg:px-10 lg:pt-8">
            <PropertySelector />
          </div>
          <main id="main" className="min-w-0 flex-1 px-5 pt-6 pb-16 md:px-8 lg:px-14 lg:pt-8">
            <div className="max-w-6xl">{children}</div>
          </main>
        </div>
      </div>
    </PropertyContextProvider>
  );
}
