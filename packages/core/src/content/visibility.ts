import { type StayWindow } from "../stay/stay-phase";

/**
 * Time-based visibility of content (ADR 0005) – deliberately simple, no rules engine.
 *
 * A boundary is either an absolute instant or relative to the stay's check-in /
 * check-out instant (e.g. door code from 15 minutes before check-in).
 * Possible later extension without breaking this shape: a `time` of day in the
 * property's time zone (e.g. "from 00:00 on the departure day").
 */
export type VisibilityBoundary =
  | { type: "absolute"; at: string }
  | { type: "stay"; anchor: "check-in" | "check-out"; offsetMinutes?: number };

export type ContentAudience = "public" | "reservation";

export type Visibility = {
  /** Who may see it: `public` (e.g. QR code in the apartment) or guests with a reservation link. */
  audience?: ContentAudience;
  /** Visible from (inclusive). Missing = no lower bound. */
  from?: VisibilityBoundary;
  /** Visible until (exclusive). Missing = no upper bound. */
  until?: VisibilityBoundary;
};

export type VisibilityContext = {
  now: Date;
  /** The guest's access level for this request. */
  access: ContentAudience;
  /** Present when a stay is known; stay-relative boundaries never match without it. */
  stay?: StayWindow;
};

function resolveBoundary(
  boundary: VisibilityBoundary,
  stay: StayWindow | undefined,
): number | null {
  if (boundary.type === "absolute") {
    return Date.parse(boundary.at);
  }
  if (!stay) {
    return null;
  }
  const anchor = Date.parse(boundary.anchor === "check-in" ? stay.checkInAt : stay.checkOutAt);
  return anchor + (boundary.offsetMinutes ?? 0) * 60_000;
}

/** `undefined` visibility means: visible to guests with a reservation, at any time. */
export function isVisible(visibility: Visibility | undefined, context: VisibilityContext): boolean {
  const audience = visibility?.audience ?? "reservation";
  if (audience === "reservation" && context.access !== "reservation") {
    return false;
  }
  const t = context.now.getTime();
  if (visibility?.from) {
    const from = resolveBoundary(visibility.from, context.stay);
    if (from === null || Number.isNaN(from) || t < from) return false;
  }
  if (visibility?.until) {
    const until = resolveBoundary(visibility.until, context.stay);
    if (until === null || Number.isNaN(until) || t >= until) return false;
  }
  return true;
}
