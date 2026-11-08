"use client";

/**
 * Privacy-friendly measurement in the browser (Phase 1): impressions (an offer was at least
 * half visible), detail views and click-outs, reported as offer id + event + placement only.
 * No cookies, no identifiers, no storage; the server counts daily totals.
 */
import { type ReactNode, useEffect, useRef } from "react";

import { reportOfferEvents } from "../../features/upsell/actions";

type Placement = "home" | "services" | "detail";
type Event = { offerId: string; event: "impression" | "view" | "click-out"; placement: Placement };

const queue: Event[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  timer = undefined;
  const batch = queue.splice(0, queue.length);
  if (batch.length > 0) void reportOfferEvents(batch).catch(() => undefined);
}

function report(event: Event) {
  queue.push(event);
  timer ??= setTimeout(flush, 1200);
}

/** Counts each `[data-offer-id]` inside once per page view when it becomes visible. */
export function OfferImpressions({
  placement,
  children,
  className,
}: {
  placement: Placement;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const seen = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.offerId;
          if (!entry.isIntersecting || !id || seen.has(id)) continue;
          seen.add(id);
          observer.unobserve(entry.target);
          report({ offerId: id, event: "impression", placement });
        }
      },
      { threshold: 0.5 },
    );
    root.querySelectorAll<HTMLElement>("[data-offer-id]").forEach((el) => {
      observer.observe(el);
    });
    return () => {
      observer.disconnect();
    };
  }, [placement]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** One detail view per page view. */
export function OfferViewBeacon({ offerId }: { offerId: string }) {
  useEffect(() => {
    report({ offerId, event: "view", placement: "detail" });
  }, [offerId]);
  return null;
}

/** External partner page: counted as click-out, opened without referrer or opener. */
export function OfferClickOut({
  offerId,
  href,
  className,
  children,
}: {
  offerId: string;
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      className={className}
      onClick={() => {
        report({ offerId, event: "click-out", placement: "detail" });
        flush();
      }}
    >
      {children}
    </a>
  );
}
