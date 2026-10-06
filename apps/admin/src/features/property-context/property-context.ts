import { PROPERTY_COOKIE } from "../../navigation";

export type ContextProperty = {
  id: string;
  displayName: string;
  spokenName: string;
  locationName: string;
};

/** A cookie value only counts if it is one of the tenant's properties. */
export function rememberedProperty(
  value: string | undefined,
  properties: readonly Pick<ContextProperty, "id">[],
): string | null {
  return value && properties.some((property) => property.id === value) ? value : null;
}

/** Cookie string for remembering the choice ("" = Alle Objekte). Not security relevant. */
export function propertyCookie(propertyId: string | null, secure: boolean): string {
  return [
    `${PROPERTY_COOKIE}=${propertyId ? encodeURIComponent(propertyId) : ""}`,
    "Path=/",
    `Max-Age=${String(60 * 60 * 24 * 365)}`,
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
