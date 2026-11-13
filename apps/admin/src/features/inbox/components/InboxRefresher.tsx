"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Polling (ADR 0023, stage 1): asks a light, permission-checked endpoint for the newest change
 * and refreshes the page only when something changed. Pauses while the tab is hidden. Push
 * notifications are an addition – this keeps the inbox current without them.
 */
export function InboxRefresher({
  marker,
  intervalMs,
}: {
  marker: string | null;
  intervalMs: number;
}) {
  const router = useRouter();
  const known = useRef(marker);

  useEffect(() => {
    known.current = marker;
  }, [marker]);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/inbox/changes", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { latest: string | null };
        if (!stopped && data.latest !== known.current) {
          known.current = data.latest;
          router.refresh();
        }
      } catch {
        // offline – try again on the next tick
      }
    };
    const timer = window.setInterval(() => void tick(), intervalMs);
    const onVisible = () => void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, router]);

  return null;
}
