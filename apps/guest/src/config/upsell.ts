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

/** Booking own services inside STAY (Phase 2): test properties only, on top of Phase 1. */
export function extrasBridgeEnabled(
  property: Pick<RegisteredProperty, "testOnly" | "design" | "upsell" | "extras">,
): boolean {
  return upsellEnabled(property) && property.extras === "bridge";
}

/** The only Apaleo property the STAY engine may serve guests for before the joint go-live. */
export const STAY_ENGINE_APALEO_PROPERTIES: readonly string[] = ["TEST"];

/**
 * M4 feature switch: the own STAY booking engine replaces the Extras bridge in the guest app
 * only when GUEST_SERVICE_ENGINE=test AND the property is a test property AND it is mapped to
 * the Apaleo TEST property. Real properties always keep the Extras bridge; enabling the engine
 * for them needs the go-live approval and a code change here.
 */
export function stayEngineEnabled(
  property: Pick<RegisteredProperty, "testOnly" | "design" | "upsell" | "extras" | "pms">,
  switchValue: "off" | "test",
): boolean {
  return (
    switchValue === "test" &&
    extrasBridgeEnabled(property) &&
    property.testOnly === true &&
    STAY_ENGINE_APALEO_PROPERTIES.includes(property.pms.propertyId)
  );
}
