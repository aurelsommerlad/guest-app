import { isVisible, type VisibilityContext } from "../content/visibility";
import {
  type ContentScope,
  type GuideEntry,
  type GuideOverride,
  type GuideSection,
  type GuideTopic,
} from "./guide-model";

export type GuideContext = VisibilityContext & {
  tenantId: string;
  propertyId: string;
  unitId?: string;
};

/** Whether a scope applies to the guest's property/unit. */
export function scopeApplies(scope: ContentScope, context: GuideContext): boolean {
  switch (scope.level) {
    case "tenant":
      return true;
    case "property":
      return scope.propertyId === context.propertyId;
    case "unit":
      return scope.propertyId === context.propertyId && scope.unitId === context.unitId;
  }
}

const SPECIFICITY: Record<ContentScope["level"], number> = { tenant: 0, property: 1, unit: 2 };

/**
 * The guide a guest sees (ADR 0013), from all entries of their tenant:
 *
 * 1. Topics: published, same tenant, scope applies, currently visible. Several topics
 *    with the same `key` (tenant default, property, unit) → the most specific wins.
 * 2. Content: a published override for the guest's unit with the topic's `key`
 *    replaces intro, hero image and blocks; otherwise the topic's own content is used.
 *    Title, slug, icon and order always come from the topic.
 * 3. Blocks are filtered by their own visibility; result sorted by the topic's order.
 */
export function resolveGuideSections(
  entries: readonly GuideEntry[],
  context: GuideContext,
): GuideSection[] {
  const live = entries.filter(
    (entry) =>
      entry.status === "published" &&
      entry.tenantId === context.tenantId &&
      scopeApplies(entry.scope, context),
  );

  const topics = new Map<string, GuideTopic>();
  for (const entry of live) {
    if (entry.kind !== "topic" || !isVisible(entry.visibility, context)) continue;
    const current = topics.get(entry.key);
    if (!current || SPECIFICITY[entry.scope.level] > SPECIFICITY[current.scope.level]) {
      topics.set(entry.key, entry);
    }
  }

  const overrides = new Map<string, GuideOverride>();
  for (const entry of live) {
    if (entry.kind === "override") overrides.set(entry.key, entry);
  }

  return [...topics.values()]
    .map((topic): GuideSection => {
      const content = overrides.get(topic.key) ?? topic;
      return {
        id: topic.id,
        tenantId: topic.tenantId,
        key: topic.key,
        scope: topic.scope,
        status: "published",
        slug: topic.slug,
        ...(topic.eyebrow ? { eyebrow: topic.eyebrow } : {}),
        title: topic.title,
        shortDescription: topic.shortDescription,
        icon: topic.icon,
        sortOrder: topic.sortOrder,
        ...(topic.visibility ? { visibility: topic.visibility } : {}),
        ...(content.intro ? { intro: content.intro } : {}),
        ...(content.heroImage ? { heroImage: content.heroImage } : {}),
        blocks: content.blocks.filter((block) => isVisible(block.visibility, context)),
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
