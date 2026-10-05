import { type GuideSection, type Logger, resolveGuideSections } from "@up/core";
import { type Database, listPublishedGuideEntries } from "@up/db";

import { type GuestContext } from "../guest-context/guest-context";
import { guideContextOf } from "./guide-context";

/**
 * GUIDE content for the guest context (ADR 0013): published entries of the guest's tenant,
 * property and unit from the database, resolved with unit overrides by `key`.
 * Without a database (local preview without DATABASE_URL) the guide is simply empty.
 */
export async function loadGuideSections(
  db: Database | undefined,
  context: GuestContext,
  logger: Logger,
): Promise<GuideSection[]> {
  if (!db) return [];
  try {
    const entries = await listPublishedGuideEntries(
      db,
      { tenantId: context.tenantId },
      { propertyId: context.propertyId, ...(context.unitId ? { unitId: context.unitId } : {}) },
    );
    return resolveGuideSections(entries, guideContextOf(context));
  } catch (error) {
    logger.error("guide content could not be loaded", {
      error: error instanceof Error ? { name: error.name } : "unknown",
    });
    return [];
  }
}
