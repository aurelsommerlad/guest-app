"use client";

import { useMemo, useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

/** Resolves var() chains to concrete computed colors via a hidden probe element. */
function resolveColors(key: string): string {
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.appendChild(probe);
  const resolved: Record<string, string> = {};
  for (const variable of key.split("|")) {
    probe.style.color = `var(${variable})`;
    resolved[variable] = getComputedStyle(probe).color;
  }
  probe.remove();
  // A string snapshot compares by value, so React does not re-render needlessly.
  return JSON.stringify(resolved);
}

/**
 * Reads the computed color of CSS custom properties in the browser.
 * Token values therefore stay defined only in tokens.css. Empty during SSR.
 */
export function useResolvedColors(variables: readonly string[]): Record<string, string> {
  const key = variables.join("|");
  const snapshot = useSyncExternalStore(
    subscribe,
    () => resolveColors(key),
    () => "",
  );
  return useMemo(
    () => (snapshot ? (JSON.parse(snapshot) as Record<string, string>) : {}),
    [snapshot],
  );
}
