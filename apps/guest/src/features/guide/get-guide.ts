import "server-only";

import { type GuideContext, selectGuideSections } from "@up/core";

import { type HeaderProperty } from "../../components/GuestHeader";
import { findPropertyById } from "../../config/properties";
import { type Locale } from "../../i18n/routing";
import { hovGuideSections } from "../../mocks/guide/hov-guide";
import { MOCK_NOW, mockReservation } from "../../mocks/stay/mock-stay";
import { type GuideArticle, type GuideOverviewItem } from "./model";
import { createGuideResolver } from "./resolve-guide";

/**
 * GUIDE data access. Mock content + mock guest context (HØV · ROS).
 *
 * Deliberately independent of the PMS: guide pages never call Apaleo, so they keep
 * working when the PMS is unavailable. Later the context comes from the guest
 * session (property/unit stored with the guest access), content from our database.
 */
const GUIDE_PROPERTY_ID = "hov";
const GUIDE_UNIT_ID = "ros";

function guideProperty() {
  const property = findPropertyById(GUIDE_PROPERTY_ID);
  if (!property) throw new Error(`Guide property ${GUIDE_PROPERTY_ID} is not registered`);
  return property;
}

function guideContext(): GuideContext {
  const property = guideProperty();
  return {
    tenantId: property.tenantId,
    propertyId: property.id,
    unitId: GUIDE_UNIT_ID,
    now: MOCK_NOW,
    access: "reservation",
    stay: { checkInAt: mockReservation.arrivalAt, checkOutAt: mockReservation.departureAt },
  };
}

/** Property shown in the GUIDE header. */
export function getGuideProperty(): HeaderProperty {
  const { name, spokenName, location } = guideProperty();
  return { name, spokenName, location };
}

function visibleSections() {
  return selectGuideSections(hovGuideSections, guideContext());
}

export function getGuideOverview(locale: Locale): GuideOverviewItem[] {
  const resolver = createGuideResolver(locale);
  return visibleSections().map(resolver.overviewItem);
}

export function getGuideArticle(locale: Locale, slug: string): GuideArticle | undefined {
  const resolver = createGuideResolver(locale);
  const section = visibleSections().find((candidate) => resolver.slug(candidate) === slug);
  return section ? resolver.article(section) : undefined;
}

/** Slugs for static generation of the detail pages. */
export function getGuideSlugs(locale: Locale): string[] {
  const resolver = createGuideResolver(locale);
  return visibleSections().map(resolver.slug);
}
