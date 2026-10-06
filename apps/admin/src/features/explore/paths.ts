/**
 * EXPLORE admin URLs. The property context stays in the URL: `/explore` (Alle Objekte) or
 * `/explore/<propertyId>`. Places belong to the tenant, so their editor exists in both.
 */
export function explorePath(propertyId: string | null): string {
  return propertyId ? `/explore/${encodeURIComponent(propertyId)}` : "/explore";
}

export function placePath(propertyId: string | null, placeId: string): string {
  return propertyId
    ? `${explorePath(propertyId)}/${encodeURIComponent(placeId)}`
    : `/explore/places/${encodeURIComponent(placeId)}`;
}

export function newPlacePath(propertyId: string | null): string {
  return `${explorePath(propertyId)}/new`;
}
