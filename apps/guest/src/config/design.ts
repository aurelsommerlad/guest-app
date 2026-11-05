import { type RegisteredProperty } from "./properties";

export type GuestDesign = "current" | "v2";

/**
 * The guest design of a property. Design V2 (ADR 0020) can only be switched on for test
 * properties – which never resolve in production – so real guests always see the current
 * design until V2 is approved.
 */
export function designOf(property: Pick<RegisteredProperty, "testOnly" | "design">): GuestDesign {
  return property.testOnly && property.design === "v2" ? "v2" : "current";
}
