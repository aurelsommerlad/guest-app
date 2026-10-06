"use server";

import { hashSecret } from "@up/core";
import { hitRateLimit } from "@up/db";

import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { getGuestContext } from "../guest-context/server";
import { journeyDeps } from "./server";
import { loadStayJourney } from "./stay-journey";

export type RevealResult =
  { status: "ok"; code: string } | { status: "unavailable" } | { status: "rate-limited" };

const REVEAL_LIMIT = { windowMs: 15 * 60 * 1000, max: 20 } as const;

/**
 * Reveals the access code on explicit request (ADR 0017). Re-checks session, release
 * rules and registration requirement on the server; rate limited per reservation. The code
 * travels only in this POST response – never in HTML, URLs, logs or analytics.
 */
export async function revealAccessCode(): Promise<RevealResult> {
  const result = await getGuestContext();
  if (result.kind !== "context") return { status: "unavailable" };
  const context = result.context;
  const db = getDatabase();
  if (!db) return { status: "unavailable" };
  const subject = hashSecret(
    `${context.tenantId}:${context.reservationProvider}:${context.externalReservationId}`,
  );
  const bucket = await hitRateLimit(
    db,
    `access-reveal:${subject}`,
    REVEAL_LIMIT.windowMs,
    new Date(),
  );
  if (bucket.hits > REVEAL_LIMIT.max) {
    logger.warn("access code reveal rate limited", { guestAccessId: context.guestAccessId });
    return { status: "rate-limited" };
  }
  const journey = await loadStayJourney(journeyDeps(), context, { includeAccessCode: true });
  const code =
    journey?.access.status === "available" ? journey.access.credential.displayValue : undefined;
  if (!code) return { status: "unavailable" };
  logger.info("access code revealed", {
    guestAccessId: context.guestAccessId,
    propertyId: context.propertyId,
    unitId: context.unitId,
  });
  return { status: "ok", code };
}
