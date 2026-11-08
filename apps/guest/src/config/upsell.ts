import { type RegisteredProperty } from "./properties";

/**
 * "Services & Erlebnisse" (upselling concept, Phase 1) is only switched on for test
 * properties – which never resolve in production – and only together with design V2.
 */
export function upsellEnabled(
  property: Pick<RegisteredProperty, "testOnly" | "design" | "upsell">,
): boolean {
  return property.testOnly === true && property.design === "v2" && property.upsell === "v1";
}
