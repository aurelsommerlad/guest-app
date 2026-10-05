import "server-only";

import { cache } from "react";

import { type Locale } from "../../i18n/routing";
import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { type GuestContext } from "../guest-context/guest-context";
import { loadGuideSections } from "./guide-content";
import { type GuideArticle, type GuideOverviewItem } from "./model";
import { createGuideResolver } from "./resolve-guide";

/** Loaded once per request and guest context (overview, detail page and its metadata). */
const visibleSections = cache((context: GuestContext) =>
  loadGuideSections(getDatabase(), context, logger),
);

export async function getGuideOverview(
  context: GuestContext,
  locale: Locale,
): Promise<GuideOverviewItem[]> {
  const resolver = createGuideResolver(locale);
  return (await visibleSections(context)).map(resolver.overviewItem);
}

export async function getGuideArticle(
  context: GuestContext,
  locale: Locale,
  slug: string,
): Promise<GuideArticle | undefined> {
  const resolver = createGuideResolver(locale);
  const section = (await visibleSections(context)).find(
    (candidate) => resolver.slug(candidate) === slug,
  );
  return section ? resolver.article(section) : undefined;
}
