import { type ExplorePlace, type Logger, selectExplorePlaces } from "@up/core";
import { type Database, listPublishedExplorePlaces } from "@up/db";

import { type GuestContext } from "../guest-context/guest-context";

/**
 * EXPLORE places for the guest context (ADR 0015): published places of the guest's tenant
 * that are assigned to the guest's property, in editorial order. The selection is applied
 * again in memory as a second guard. Without a database (local preview) EXPLORE is empty.
 */
export async function loadExplorePlaces(
  db: Database | undefined,
  context: GuestContext,
  logger: Logger,
): Promise<ExplorePlace[]> {
  if (!db) return [];
  try {
    const places = await listPublishedExplorePlaces(
      db,
      { tenantId: context.tenantId },
      context.propertyId,
    );
    return selectExplorePlaces(places, {
      tenantId: context.tenantId,
      propertyId: context.propertyId,
    });
  } catch (error) {
    logger.error("explore places could not be loaded", {
      error: error instanceof Error ? { name: error.name } : "unknown",
    });
    return [];
  }
}
