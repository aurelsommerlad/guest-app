import "server-only";

import { selectGuideSections } from "@up/core";

import { type Locale } from "../../i18n/routing";
import { hovGuideSections } from "../../mocks/guide/hov-guide";
import { type GuestContext } from "../guest-context/guest-context";
import { guideContextOf } from "./guide-context";
import { type GuideArticle, type GuideOverviewItem } from "./model";
import { createGuideResolver } from "./resolve-guide";

/** GUIDE data access: content (mock until the database) selected for the guest context. */
function visibleSections(context: GuestContext) {
  return selectGuideSections(hovGuideSections, guideContextOf(context));
}

export function getGuideOverview(context: GuestContext, locale: Locale): GuideOverviewItem[] {
  const resolver = createGuideResolver(locale);
  return visibleSections(context).map(resolver.overviewItem);
}

export function getGuideArticle(
  context: GuestContext,
  locale: Locale,
  slug: string,
): GuideArticle | undefined {
  const resolver = createGuideResolver(locale);
  const section = visibleSections(context).find((candidate) => resolver.slug(candidate) === slug);
  return section ? resolver.article(section) : undefined;
}
