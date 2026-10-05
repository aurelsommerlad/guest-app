import { isVisible, type VisibilityContext } from "../content/visibility";
import { type ContentScope, type GuideSection } from "./guide-model";

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

/**
 * The guide sections a guest sees: published, of their tenant, applicable to their
 * property/unit, currently visible – ordered by sortOrder. Blocks are filtered by
 * their own visibility. (Overrides by `key` across scopes come later.)
 */
export function selectGuideSections(
  sections: readonly GuideSection[],
  context: GuideContext,
): GuideSection[] {
  return sections
    .filter(
      (section) =>
        section.status === "published" &&
        section.tenantId === context.tenantId &&
        scopeApplies(section.scope, context) &&
        isVisible(section.visibility, context),
    )
    .map((section) => ({
      ...section,
      blocks: section.blocks.filter((block) => isVisible(block.visibility, context)),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
