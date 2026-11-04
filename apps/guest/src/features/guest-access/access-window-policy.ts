import { type AccessWindowPolicy, type AppEnvironment } from "@up/core";

import { findPropertyById } from "../../config/properties";

/**
 * Test properties (registry `testOnly`, e.g. the Apaleo test property "TEST") may be
 * entered long before arrival, so test reservations can be tried end to end on
 * local/staging/preview. Everything else (link, last name, revocation, reservation
 * status, closing 3 days after departure) stays as for real guests.
 */
export const TEST_PROPERTY_ACCESS_WINDOW: AccessWindowPolicy = {
  opensDaysBeforeArrival: 365,
  closesDaysAfterDeparture: 3,
};

/**
 * Access window for a property of a tenant – undefined means the default policy. Never
 * deviates in production, and only for a test property of exactly this tenant.
 */
export function accessWindowPolicyFor(
  appEnv: AppEnvironment,
  property: { tenantId: string; propertyId: string },
): AccessWindowPolicy | undefined {
  if (appEnv === "production") return undefined;
  const registered = findPropertyById(property.propertyId);
  if (!registered?.testOnly || registered.tenantId !== property.tenantId) return undefined;
  return TEST_PROPERTY_ACCESS_WINDOW;
}
