import "server-only";

import { type GuideContext, selectGuideSections } from "@up/core";

import { type HeaderProperty } from "../../components/GuestHeader";
import { type Locale } from "../../i18n/routing";
import { hovGuideSections } from "../../mocks/guide/hov-guide";
import { getGuestContext, headerPropertyOf } from "../guest-context";
import { type GuideArticle, type GuideOverviewItem } from "./model";
import { createGuideResolver } from "./resolve-guide";

/** GUIDE data access: mock content for the guest context (see guest-context.ts). */
function guideContext(): GuideContext {
  const { property, unitId, now, stay } = getGuestContext();
  return {
    tenantId: property.tenantId,
    propertyId: property.id,
    unitId,
    now,
    access: "reservation",
    stay,
  };
}

/** Property shown in the GUIDE header. */
export function getGuideProperty(): HeaderProperty {
  return headerPropertyOf(getGuestContext().property);
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
