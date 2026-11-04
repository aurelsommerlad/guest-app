import { findPropertyById, type RegisteredProperty } from "./properties";

/** Where a guest's content (GUIDE, EXPLORE, photo cards) is read from. */
export type ContentScope = {
  tenantId: string;
  propertyId: string;
  unitId?: string;
};

/**
 * The content scope of a property and unit. Normally the property itself. A test property
 * with a `contentSource` reads the published content of that source property instead – but
 * only if every guard holds; otherwise it falls back to its own (usually empty) content:
 *
 * - only test properties may borrow content (a real property never shows another's content),
 * - the source exists, is a real property and belongs to the same tenant,
 * - a mapped unit belongs to the source property (unmapped units: general content only).
 *
 * Tenant isolation is unchanged: content is still read for exactly one tenant.
 */
export function contentScopeOf(
  /** The guest's tenant (from the access/context) – always authoritative. */
  tenantId: string,
  property: Pick<RegisteredProperty, "id" | "tenantId" | "testOnly" | "contentSource">,
  unitId: string | undefined,
  lookup: (id: string) => RegisteredProperty | undefined = findPropertyById,
): ContentScope {
  const own: ContentScope = { tenantId, propertyId: property.id, ...(unitId ? { unitId } : {}) };
  const link = property.contentSource;
  if (!link || !property.testOnly || property.tenantId !== tenantId) return own;
  const source = lookup(link.propertyId);
  if (!source || source.testOnly || source.tenantId !== tenantId) return own;
  const mapped = unitId ? link.units?.[unitId] : undefined;
  const sourceUnit = mapped && source.units.some((unit) => unit.id === mapped) ? mapped : undefined;
  return {
    tenantId: source.tenantId,
    propertyId: source.id,
    ...(sourceUnit ? { unitId: sourceUnit } : {}),
  };
}
