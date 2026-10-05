import { type GuideContext } from "@up/core";

import { type GuestContext, stayWindowOf } from "../guest-context/guest-context";

/** GUIDE selection context from the central guest context (property, unit, stay, time). */
export function guideContextOf(context: GuestContext): GuideContext {
  const stay = stayWindowOf(context);
  return {
    tenantId: context.tenantId,
    propertyId: context.propertyId,
    ...(context.unitId ? { unitId: context.unitId } : {}),
    now: context.now,
    access: "reservation",
    ...(stay ? { stay } : {}),
  };
}
