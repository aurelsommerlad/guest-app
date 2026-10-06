/**
 * EXPLORE administration (ADR 0015). All reads and writes run with the admin session's
 * TenantContext; property assignments are checked against the tenant's properties before
 * writing (and by composite foreign keys in the database).
 */
import {
  englishStateOf,
  EXPLORE_CATEGORIES,
  type ExploreCategory,
  type ExploreStatus,
  explorePlaceSchema,
  GUIDE_STATUSES,
  type LocalizedText,
  type Logger,
  slugify,
  type TenantContext,
} from "@up/core";
import {
  createExplorePlace,
  type Database,
  deleteUnpublishedExplorePlace,
  ExploreAssignmentError,
  type ExplorePlaceRecord,
  getExplorePlace,
  listExplorePlaces,
  listPropertiesForTenant,
  setExplorePlaceOrder,
  setExplorePlaceStatus,
  updateExplorePlace,
} from "@up/db";

export type ExploreAdminDeps = {
  db: Database;
  logger: Logger;
  now: () => Date;
  /** Images must come from this tenant's EXPLORE media (or local fixtures). */
  isAllowedImageSrc: (src: string, tenantId: string) => boolean;
  /** Checks the stored file behind an image that is new in the saved place. */
  verifyNewImage: (src: string, tenantId: string) => Promise<boolean>;
};

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export type PropertyOption = {
  id: string;
  displayName: string;
  spokenName: string;
  locationName: string;
};

export type PlaceSummary = {
  id: string;
  title: LocalizedText;
  teaser: LocalizedText;
  category: ExploreCategory;
  status: ExploreStatus;
  featured: boolean;
  locality?: string;
  address?: string;
  description?: LocalizedText;
  heroImageSrc?: string;
  propertyIds: readonly string[];
  englishComplete: boolean;
};

export const CATEGORY_LABELS: Record<ExploreCategory, string> = {
  "food-drink": "Essen & Trinken",
  nature: "Natur & Ausflüge",
  activities: "Aktivitäten",
  wellness: "Baden & Wellness",
  shopping: "Einkaufen",
  sights: "Sehenswertes",
};

async function tenantProperties(
  deps: ExploreAdminDeps,
  context: TenantContext,
): Promise<PropertyOption[]> {
  return (await listPropertiesForTenant(deps.db, context)).map((property) => ({
    id: property.id,
    displayName: property.displayName,
    spokenName: property.spokenName,
    locationName: property.locationName,
  }));
}

function placeTexts(
  place: Pick<
    ExplorePlaceRecord,
    "title" | "teaser" | "description" | "tip" | "openingHours" | "heroImage"
  >,
) {
  return [
    place.title,
    place.teaser,
    place.description,
    place.tip,
    place.openingHours,
    place.heroImage?.alt,
  ];
}

function summaryOf(place: ExplorePlaceRecord): PlaceSummary {
  return {
    id: place.id,
    title: place.title,
    teaser: place.teaser,
    category: place.category,
    status: place.status,
    featured: place.featured,
    propertyIds: place.propertyIds,
    englishComplete: englishStateOf(placeTexts(place)) === "reviewed",
    ...(place.locality ? { locality: place.locality } : {}),
    ...(place.address ? { address: place.address } : {}),
    ...(place.description ? { description: place.description } : {}),
    ...(place.heroImage ? { heroImageSrc: place.heroImage.src } : {}),
  };
}

/** Places of the tenant (or of one property, which must belong to the tenant). */
export async function loadExploreOverview(
  deps: ExploreAdminDeps,
  context: TenantContext,
  propertyId: string | null,
): Promise<{ properties: PropertyOption[]; places: PlaceSummary[] } | undefined> {
  const properties = await tenantProperties(deps, context);
  if (propertyId !== null && !properties.some((property) => property.id === propertyId)) {
    return undefined;
  }
  const places = await listExplorePlaces(deps.db, context, {
    includeArchived: true,
    ...(propertyId === null ? {} : { propertyId }),
  });
  return { properties, places: places.map(summaryOf) };
}

export async function loadPlace(
  deps: ExploreAdminDeps,
  context: TenantContext,
  placeId: string,
): Promise<
  { place: ExplorePlaceRecord; properties: PropertyOption[]; englishComplete: boolean } | undefined
> {
  const place = await getExplorePlace(deps.db, context, placeId);
  if (!place) return undefined;
  return {
    place,
    properties: await tenantProperties(deps, context),
    englishComplete: englishStateOf(placeTexts(place)) === "reviewed",
  };
}

/** A slug not used by another non-archived place of the tenant (per locale). */
function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const root = base || "empfehlung";
  if (!taken.has(root)) return root;
  for (let index = 2; ; index++) {
    const candidate = `${root}-${String(index)}`.slice(0, 80);
    if (!taken.has(candidate)) return candidate;
  }
}

async function takenSlugs(
  deps: ExploreAdminDeps,
  context: TenantContext,
  exceptId?: string,
): Promise<{ de: Set<string>; en: Set<string> }> {
  const places = (await listExplorePlaces(deps.db, context)).filter(
    (place) => place.id !== exceptId,
  );
  const all = new Set(
    places.flatMap((place) =>
      [place.slug.de, place.slug.en].filter((slug): slug is string => Boolean(slug)),
    ),
  );
  return { de: all, en: all };
}

export type NewPlaceInput = {
  titleDe: string;
  titleEn: string;
  teaserDe: string;
  teaserEn: string;
  category: string;
  propertyIds: string[];
};

/** Creates a draft place; slug from the title, placed after all others. */
export async function createPlace(
  deps: ExploreAdminDeps,
  context: TenantContext,
  input: NewPlaceInput,
): Promise<Result<{ id: string }>> {
  const titleDe = input.titleDe.trim();
  const titleEn = input.titleEn.trim();
  const teaserDe = input.teaserDe.trim();
  const teaserEn = input.teaserEn.trim();
  if (!titleDe || titleDe.length > 120) return fail("Bitte einen deutschen Titel angeben.");
  if (!teaserDe || teaserDe.length > 220 || teaserEn.length > 220 || titleEn.length > 120) {
    return fail("Bitte eine deutsche Kurzbeschreibung angeben.");
  }
  if (!(EXPLORE_CATEGORIES as readonly string[]).includes(input.category)) {
    return fail("Bitte eine Kategorie wählen.");
  }
  const taken = await takenSlugs(deps, context);
  const slugDe = uniqueSlug(slugify(titleDe), taken.de);
  const slugEn = titleEn ? uniqueSlug(slugify(titleEn), new Set([...taken.en, slugDe])) : undefined;
  const existing = await listExplorePlaces(deps.db, context, { includeArchived: true });
  const title = titleEn ? { de: titleDe, en: titleEn } : { de: titleDe };
  const teaser = teaserEn ? { de: teaserDe, en: teaserEn } : { de: teaserDe };
  try {
    const place = await createExplorePlace(deps.db, context, {
      category: input.category as ExploreCategory,
      slug: slugEn ? { de: slugDe, en: slugEn } : { de: slugDe },
      title,
      teaser,
      featured: false,
      translationState: { en: englishStateOf([title, teaser]) },
      propertyIds: input.propertyIds,
      sortOrder: Math.max(0, ...existing.map((place) => place.sortOrder)) + 10,
    });
    return { ok: true, id: place.id };
  } catch (error) {
    if (error instanceof ExploreAssignmentError) return fail("Ungültige Objekt-Zuordnung.");
    throw error;
  }
}

/** Raw editor values (all strings from the form; image as JSON). */
export type PlaceFormInput = {
  titleDe: string;
  titleEn: string;
  slugDe: string;
  slugEn: string;
  category: string;
  teaserDe: string;
  teaserEn: string;
  descriptionDe: string;
  descriptionEn: string;
  tipDe: string;
  tipEn: string;
  openingHoursDe: string;
  openingHoursEn: string;
  heroImage: string;
  address: string;
  locality: string;
  mapsUrl: string;
  websiteUrl: string;
  phone: string;
  reservationUrl: string;
  featured: boolean;
  propertyIds: string[];
};

const pair = (de: string, en: string) => ({ de, ...(en.trim() ? { en } : {}) });

function parseImage(raw: string): unknown {
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

const FIELD_NAMES: Record<string, string> = {
  title: "Titel",
  slug: "Adressname (URL)",
  category: "Kategorie",
  teaser: "Kurzbeschreibung",
  description: "Beschreibung",
  tip: "Unser Tipp",
  openingHours: "Öffnungszeiten",
  heroImage: "Titelbild",
  address: "Adresse",
  locality: "Ort",
  mapsUrl: "Karten-Link",
  websiteUrl: "Website",
  phone: "Telefon",
  reservationUrl: "Reservierungslink",
  propertyIds: "Objekte",
};

/** Validates and saves all fields; published places are live at once. */
export async function updatePlace(
  deps: ExploreAdminDeps,
  context: TenantContext,
  placeId: string,
  input: PlaceFormInput,
): Promise<Result> {
  const existing = await getExplorePlace(deps.db, context, placeId);
  if (!existing) return fail("Empfehlung nicht gefunden.");
  const image = parseImage(input.heroImage);
  const parsed = explorePlaceSchema((src) =>
    deps.isAllowedImageSrc(src, context.tenantId),
  ).safeParse({
    title: pair(input.titleDe, input.titleEn),
    slug: pair(input.slugDe.trim(), input.slugEn.trim()),
    category: input.category,
    teaser: pair(input.teaserDe, input.teaserEn),
    description: { de: input.descriptionDe, en: input.descriptionEn },
    tip: { de: input.tipDe, en: input.tipEn },
    openingHours: { de: input.openingHoursDe, en: input.openingHoursEn },
    ...(image === undefined ? {} : { heroImage: image }),
    address: input.address,
    locality: input.locality,
    mapsUrl: input.mapsUrl,
    websiteUrl: input.websiteUrl,
    phone: input.phone,
    reservationUrl: input.reservationUrl,
    featured: input.featured,
    propertyIds: input.propertyIds,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = FIELD_NAMES[String(issue?.path[0] ?? "")] ?? "Eingabe";
    return fail(`Bitte prüfe das Feld „${field}“.`);
  }
  const place = parsed.data;

  // Unique URL names among the tenant's other live places.
  const taken = await takenSlugs(deps, context, placeId);
  if (taken.de.has(place.slug.de) || (place.slug.en && taken.en.has(place.slug.en))) {
    return fail("Dieser Adressname (URL) wird bereits von einer anderen Empfehlung verwendet.");
  }

  // A new title image must be a verified file of this tenant's EXPLORE media.
  if (place.heroImage && place.heroImage.src !== existing.heroImage?.src) {
    let verified = false;
    try {
      verified = await deps.verifyNewImage(place.heroImage.src, context.tenantId);
    } catch {
      deps.logger.error("explore image verification failed", {});
    }
    if (!verified) return fail("Das Titelbild ist ungültig oder fehlt. Bitte lade es erneut hoch.");
  }

  try {
    const ok = await updateExplorePlace(deps.db, context, placeId, {
      ...place,
      translationState: { en: englishStateOf(placeTexts(place)) },
    });
    return ok ? { ok: true } : fail("Empfehlung nicht gefunden.");
  } catch (error) {
    if (error instanceof ExploreAssignmentError) return fail("Ungültige Objekt-Zuordnung.");
    throw error;
  }
}

export async function changePlaceStatus(
  deps: ExploreAdminDeps,
  context: TenantContext,
  placeId: string,
  status: string,
): Promise<Result> {
  if (!(GUIDE_STATUSES as readonly string[]).includes(status)) return fail("Ungültiger Status.");
  const ok = await setExplorePlaceStatus(
    deps.db,
    context,
    placeId,
    status as ExploreStatus,
    deps.now(),
  );
  return ok ? { ok: true } : fail("Empfehlung nicht gefunden.");
}

export async function deletePlace(
  deps: ExploreAdminDeps,
  context: TenantContext,
  placeId: string,
): Promise<Result> {
  const place = await getExplorePlace(deps.db, context, placeId);
  if (!place) return fail("Empfehlung nicht gefunden.");
  if (place.firstPublishedAt)
    return fail("Bereits veröffentlichte Empfehlungen werden archiviert, nicht gelöscht.");
  return (await deleteUnpublishedExplorePlace(deps.db, context, placeId))
    ? { ok: true }
    : fail("Empfehlung nicht gefunden.");
}

/**
 * Moves a place one step within the current view (all places or one property's places),
 * by swapping it with its neighbour in the tenant-wide order.
 */
export async function movePlace(
  deps: ExploreAdminDeps,
  context: TenantContext,
  placeId: string,
  direction: "up" | "down",
  propertyId: string | null,
): Promise<Result> {
  const all = await listExplorePlaces(deps.db, context);
  const view =
    propertyId === null ? all : all.filter((place) => place.propertyIds.includes(propertyId));
  const index = view.findIndex((place) => place.id === placeId);
  const neighbour = view[direction === "up" ? index - 1 : index + 1];
  if (index < 0) return fail("Empfehlung nicht gefunden.");
  if (!neighbour) return { ok: true };
  const ids = all.map((place) => place.id);
  const a = ids.indexOf(placeId);
  const b = ids.indexOf(neighbour.id);
  [ids[a], ids[b]] = [neighbour.id, placeId];
  await setExplorePlaceOrder(deps.db, context, ids);
  return { ok: true };
}
