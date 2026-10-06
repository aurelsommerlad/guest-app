"use client";

import { cx, Icon, PropertyName } from "@up/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { selectorHref } from "../../navigation";
import { usePropertyContext } from "./PropertyContext";

/**
 * Global property selector: "Alle Objekte" or one property of the tenant. A disclosure
 * with a list of links – every choice is a real URL (deep links, new tab, back/forward).
 */
export function PropertySelector() {
  const { properties, activeId, remember } = usePropertyContext();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();

  // Close after navigating (adjusting state during render instead of an effect).
  if (open && openedAt !== pathname) setOpen(false);

  const active = properties.find((property) => property.id === activeId);
  const options = [
    { id: null, label: "Alle Objekte", spokenName: undefined, locationName: undefined },
    ...properties.map((property) => ({
      id: property.id,
      label: property.displayName,
      spokenName: property.spokenName,
      locationName: property.locationName,
    })),
  ];

  useEffect(() => {
    if (!open) return;
    const list = root.current?.querySelector(`#${CSS.escape(listId)}`);
    (
      list?.querySelector<HTMLElement>('a[aria-current="true"]') ??
      list?.querySelector<HTMLElement>("a")
    )?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, listId]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (!open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    const links = [
      ...(root.current?.querySelectorAll<HTMLElement>(`#${CSS.escape(listId)} a`) ?? []),
    ];
    const index = links.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;
    links[(next + links.length) % links.length]?.focus();
  }

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (open && !root.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpenedAt(pathname);
          setOpen((value) => !value);
        }}
        className="flex min-h-11 items-center gap-3 rounded-control py-1.5 pr-3 pl-4 text-left hover:bg-surface"
      >
        <span className="type-eyebrow text-text-muted">Objekt</span>
        <span className="type-title text-text">
          {active ? (
            <PropertyName name={active.displayName} spokenName={active.spokenName} />
          ) : (
            "Alle Objekte"
          )}
        </span>
        <Icon name="chevron-down" size="sm" className="text-text-muted" />
      </button>
      <div
        id={listId}
        hidden={!open}
        className="absolute top-full left-0 z-20 mt-2 w-72 max-w-full rounded-card bg-surface-raised p-2 shadow-float"
      >
        <ul className="flex flex-col">
          {options.map((option) => {
            const selected = option.id === activeId;
            return (
              <li key={option.id ?? "all"}>
                <Link
                  href={selectorHref(pathname, option.id)}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => {
                    remember(option.id);
                    setOpen(false);
                  }}
                  className={cx(
                    "flex min-h-11 items-center justify-between gap-3 rounded-control px-3 py-2 hover:bg-surface",
                    selected && "bg-surface",
                  )}
                >
                  <span className="flex flex-col">
                    <span className="type-body text-text">
                      {option.spokenName ? (
                        <PropertyName name={option.label} spokenName={option.spokenName} />
                      ) : (
                        option.label
                      )}
                    </span>
                    {option.locationName && (
                      <span className="type-caption text-text-muted">{option.locationName}</span>
                    )}
                  </span>
                  {selected && <Icon name="check" size="sm" className="text-text" />}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
