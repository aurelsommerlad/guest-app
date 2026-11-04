import { type ExplorePlace, type Logger, selectExplorePlaces } from "@up/core";
import { type Database, listPublishedExplorePlaces } from "@up/db";

import { contentScopeOf } from "../../config/content-source";
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
  // A test property may read a real property's places (content source, same tenant only).
  const scope = contentScopeOf(context.tenantId, context.property, context.unitId);
  try {
    const places = await listPublishedExplorePlaces(
      db,
      { tenantId: scope.tenantId },
      scope.propertyId,
    );
    return selectExplorePlaces(places, {
      tenantId: scope.tenantId,
      propertyId: scope.propertyId,
    });
  } catch (error) {
    logger.error("explore places could not be loaded", {
      error: error instanceof Error ? { name: error.name } : "unknown",
    });
    return [];
  }
}
