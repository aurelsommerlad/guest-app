import "server-only";

import { type GuideContext, selectGuideSections } from "@up/core";

import { hovGuideSections } from "../../mocks/guide/hov-guide";
import { MOCK_NOW, mockStay } from "../../mocks/stay/mock-stay";
import { type Locale } from "../../i18n/routing";
import { type GuideArticle, type GuideOverviewItem } from "./model";
import { createGuideResolver } from "./resolve-guide";

/**
 * GUIDE data access. Phase 3: mock content + mock stay context.
 * Later: load sections for the guest's tenant/property/unit from the database.
 */
function guideContext(): GuideContext {
  return {
    tenantId: mockStay.tenantId,
    propertyId: mockStay.property.id,
    unitId: mockStay.unit.id,
    now: MOCK_NOW,
    access: "reservation",
    stay: {
      checkInAt: mockStay.reservation.checkInAt,
      checkOutAt: mockStay.reservation.checkOutAt,
    },
  };
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
