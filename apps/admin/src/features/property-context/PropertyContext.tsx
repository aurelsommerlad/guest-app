"use client";

import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

import { activePropertyId, parseAdminPath } from "../../navigation";
import { type ContextProperty, propertyCookie } from "./property-context";

type PropertyContextValue = {
  properties: readonly ContextProperty[];
  /** Selected property, `null` = Alle Objekte. */
  activeId: string | null;
  /** Remembers an explicit choice (used where the URL carries no property). */
  remember: (propertyId: string | null) => void;
};

const Context = createContext<PropertyContextValue | null>(null);

function writeCookie(propertyId: string | null) {
  document.cookie = propertyCookie(propertyId, window.location.protocol === "https:");
}

/**
 * Global property context. Source of truth is the URL (property modules); the remembered
 * choice (cookie, validated on the server) covers pages without a property in the URL.
 */
export function PropertyContextProvider({
  properties,
  rememberedId,
  children,
}: {
  properties: readonly ContextProperty[];
  rememberedId: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const location = parseAdminPath(pathname);
  const ids = properties.map((property) => property.id);
  const [remembered, setRemembered] = useState(rememberedId);

  // A property module's URL is an explicit choice (also deep links, reload, back/forward):
  // remember it – unless the id is unknown (e.g. a 404 page), which never counts.
  const urlChoice =
    location.module?.scope.kind === "property" &&
    (location.propertyId === undefined || ids.includes(location.propertyId))
      ? (location.propertyId ?? null)
      : undefined;
  if (urlChoice !== undefined && urlChoice !== remembered) setRemembered(urlChoice);

  useEffect(() => {
    if (urlChoice !== undefined) writeCookie(urlChoice);
  }, [urlChoice]);

  const value: PropertyContextValue = {
    properties,
    activeId: activePropertyId(location, ids, urlChoice ?? remembered),
    remember: (propertyId) => {
      setRemembered(propertyId);
      writeCookie(propertyId);
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePropertyContext(): PropertyContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("usePropertyContext outside of PropertyContextProvider");
  return value;
}
