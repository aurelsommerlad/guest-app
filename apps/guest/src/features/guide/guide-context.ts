import { type GuideContext } from "@up/core";

import { contentScopeOf } from "../../config/content-source";
import { type GuestContext, stayWindowOf } from "../guest-context/guest-context";

/**
 * GUIDE selection context from the central guest context: the content scope (the guest's
 * property and unit – or, for a test property, its content source), stay and time.
 */
export function guideContextOf(context: GuestContext): GuideContext {
  const stay = stayWindowOf(context);
  const scope = contentScopeOf(context.tenantId, context.property, context.unitId);
  return {
    tenantId: scope.tenantId,
    propertyId: scope.propertyId,
    ...(scope.unitId ? { unitId: scope.unitId } : {}),
    now: context.now,
    access: "reservation",
    ...(stay ? { stay } : {}),
  };
}
