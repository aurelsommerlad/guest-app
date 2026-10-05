import "server-only";

import { type HeaderProperty } from "../components/GuestHeader";
import { findPropertyById, type RegisteredProperty } from "../config/properties";
import { MOCK_NOW, mockReservation } from "../mocks/stay/mock-stay";

/**
 * Guest context for content sections (GUIDE, EXPLORE): which property/unit the
 * guest stays in and when. Mock context (HØV · ROS) until guest access exists –
 * then it comes from the guest session.
 *
 * Deliberately independent of the PMS: content pages never call Apaleo, so they
 * keep working when the PMS is unavailable.
 */
const CONTEXT_PROPERTY_ID = "hov";
const CONTEXT_UNIT_ID = "ros";

export type GuestContext = {
  property: RegisteredProperty;
  unitId: string;
  now: Date;
  stay: { checkInAt: string; checkOutAt: string };
};

export function getGuestContext(): GuestContext {
  const property = findPropertyById(CONTEXT_PROPERTY_ID);
  if (!property) throw new Error(`Context property ${CONTEXT_PROPERTY_ID} is not registered`);
  return {
    property,
    unitId: CONTEXT_UNIT_ID,
    now: MOCK_NOW,
    stay: { checkInAt: mockReservation.arrivalAt, checkOutAt: mockReservation.departureAt },
  };
}

/** Property identity for the BrandHeader. */
export function headerPropertyOf(property: RegisteredProperty): HeaderProperty {
  return { name: property.name, spokenName: property.spokenName, location: property.location };
}
