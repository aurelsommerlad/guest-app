/**
 * Services administration (M2): the Extras catalog administration in STAY.
 *
 * Authorization on every call (`catalog.read` / `catalog.edit`): offer texts, images and
 * status are tenant-wide (one central offer) and need access to all properties; a property
 * configuration needs access to that property. Viewers only read.
 */
import {
  BOOKING_RULES,
  type CancellationPolicy,
  type ContentImage,
  type GuideStatus,
  GUIDE_STATUSES,
  HOUSE_SERVICE_CATEGORIES,
  type LocalizedText,
  type Logger,
  type OfferCategory,
  parsePriceToCents,
  type ServiceConfigIssue,
  serviceConfigIssues,
  SORT_ORDER_LAST,
} from "@up/core";
import {
  type CatalogOffer,
  type CatalogOfferInput,
  type CatalogPropertyConfig,
  createCatalogOffer,
  type Database,
  getCatalogOffer,
  listCatalogOffers,
  listPropertiesForTenant,
  type PropertyConfigInput,
  removePropertyConfig,
  savePropertyConfig,
  setCatalogOfferStatus,
  updateCatalogOffer,
} from "@up/db";

import { type AdminContext } from "../auth/admin-auth-service";
import { FORBIDDEN_MESSAGE, isAllowed, visibleProperties } from "../auth/authorization";
import {
  type ApaleoServiceOption,
  type ApaleoServiceSource,
  type ApaleoUnitGroupOption,
} from "./apaleo-source";

export type CatalogDeps = {
  db: Database;
  logger: Logger;
  now: () => Date;
  apaleo: ApaleoServiceSource | undefined;
  apaleoPropertyIdOf: (tenantId: string, propertyId: string) => Promise<string | undefined>;
  isAllowedImageSrc: (src: string, tenantId: string) => boolean;
};

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const tenantOf = (admin: AdminContext) => ({ tenantId: admin.tenantId });

/* ── Read ─────────────────────────────────────────────────────────────────────────────── */

export type PropertyOption = { id: string; displayName: string };

export type CatalogRow = CatalogOffer & {
  issues: Record<string, ServiceConfigIssue[]>;
};

function withIssues(offer: CatalogOffer): CatalogRow {
  return {
    ...offer,
    issues: Object.fromEntries(
      offer.properties.map((config) => [config.propertyId, serviceConfigIssues(config)]),
    ),
  };
}

export async function loadCatalog(
  deps: CatalogDeps,
  admin: AdminContext,
): Promise<Result<{ offers: CatalogRow[]; properties: PropertyOption[]; canEditOffers: boolean }>> {
  if (!isAllowed(admin, "catalog.read")) return { ok: false, error: FORBIDDEN_MESSAGE };
  const properties = visibleProperties(
    admin,
    await listPropertiesForTenant(deps.db, tenantOf(admin)),
  );
  const restricted = admin.role !== "owner" && admin.propertyScope === "selected";
  const offers = await listCatalogOffers(
    deps.db,
    tenantOf(admin),
    restricted ? { propertyIds: admin.propertyIds } : {},
  );
  return {
    ok: true,
    offers: offers.map(withIssues),
    properties: properties.map((p) => ({ id: p.id, displayName: p.displayName })),
    canEditOffers: isAllowed(admin, "catalog.edit"),
  };
}

export async function loadOffer(
  deps: CatalogDeps,
  admin: AdminContext,
  offerId: string,
): Promise<
  Result<{
    offer: CatalogRow;
    properties: PropertyOption[];
    canEditOffer: boolean;
    editableProperties: string[];
  }>
> {
  if (!isAllowed(admin, "catalog.read")) return { ok: false, error: FORBIDDEN_MESSAGE };
  const offer = await getCatalogOffer(deps.db, tenantOf(admin), offerId);
  if (!offer || offer.kind !== "house-service")
    return { ok: false, error: "Diesen Service gibt es nicht." };
  const properties = visibleProperties(
    admin,
    await listPropertiesForTenant(deps.db, tenantOf(admin)),
  );
  const visibleIds = new Set(properties.map((p) => p.id));
  const visible = {
    ...offer,
    properties: offer.properties.filter((c) => visibleIds.has(c.propertyId)),
  };
  if (
    offer.properties.length > 0 &&
    visible.properties.length === 0 &&
    !isAllowed(admin, "catalog.edit")
  ) {
    return { ok: false, error: "Diesen Service gibt es nicht." };
  }
  return {
    ok: true,
    offer: withIssues(visible),
    properties: properties.map((p) => ({ id: p.id, displayName: p.displayName })),
    canEditOffer: isAllowed(admin, "catalog.edit"),
    editableProperties: properties
      .filter((p) => isAllowed(admin, "catalog.edit", { propertyId: p.id }))
      .map((p) => p.id),
  };
}

export type ApaleoOptions =
  | {
      available: true;
      source: "apaleo" | "fixture";
      services: ApaleoServiceOption[];
      unitGroups: ApaleoUnitGroupOption[];
      apaleoPropertyId: string;
    }
  | {
      available: false;
      reason: "not-configured" | "not-mapped" | "error";
      apaleoPropertyId?: string;
    };

/** Apaleo services and unit groups of a property, read-only; never blocks the form. */
export async function loadApaleoOptions(
  deps: CatalogDeps,
  admin: AdminContext,
  propertyId: string,
): Promise<ApaleoOptions> {
  const apaleoPropertyId = await deps.apaleoPropertyIdOf(admin.tenantId, propertyId);
  if (!apaleoPropertyId) return { available: false, reason: "not-mapped" };
  if (!deps.apaleo) return { available: false, reason: "not-configured", apaleoPropertyId };
  try {
    const [services, unitGroups] = await Promise.all([
      deps.apaleo.listServices(apaleoPropertyId),
      deps.apaleo.listUnitGroups(apaleoPropertyId),
    ]);
    // The local fixture only knows the Apaleo TEST property – elsewhere: manual entry.
    if (deps.apaleo.kind === "fixture" && services.length === 0) {
      return { available: false, reason: "not-configured", apaleoPropertyId };
    }
    return { available: true, source: deps.apaleo.kind, services, unitGroups, apaleoPropertyId };
  } catch (error) {
    deps.logger.warn("apaleo service list failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return { available: false, reason: "error", apaleoPropertyId };
  }
}

/* ── Offer (central) ──────────────────────────────────────────────────────────────────── */

export type OfferForm = {
  titleDe: string;
  titleEn: string;
  teaserDe: string;
  teaserEn: string;
  bodyDe: string;
  bodyEn: string;
  detailsDe: string;
  detailsEn: string;
  category: string;
  fulfillment: string;
  cancellation: string;
  cancellationHours: string;
  heroImage: unknown;
};

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "service"
  );
}

function localized(de: string, en: string, max: number): LocalizedText | null | "too-long" {
  const d = de.trim();
  const e = en.trim();
  if (d.length > max || e.length > max) return "too-long";
  if (!d && !e) return null;
  return { de: d, ...(e ? { en: e } : {}) };
}

function parseHeroImage(
  value: unknown,
  isAllowed: (src: string) => boolean,
): ContentImage | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return "invalid";
  try {
    const image = JSON.parse(value) as Partial<ContentImage>;
    if (
      typeof image.src !== "string" ||
      !isAllowed(image.src) ||
      typeof image.width !== "number" ||
      typeof image.height !== "number" ||
      image.width < 1 ||
      image.height < 1
    ) {
      return "invalid";
    }
    const alt = (image.alt ?? {}) as Record<string, unknown>;
    return {
      src: image.src,
      width: Math.round(image.width),
      height: Math.round(image.height),
      alt: {
        de: typeof alt.de === "string" ? alt.de.slice(0, 200) : "",
        ...(typeof alt.en === "string" && alt.en ? { en: alt.en.slice(0, 200) } : {}),
      },
    };
  } catch {
    return "invalid";
  }
}

export function parseOfferForm(
  form: OfferForm,
  isAllowedImage: (src: string) => boolean,
): Result<{ input: CatalogOfferInput }> {
  const title = localized(form.titleDe, form.titleEn, 120);
  const teaser = localized(form.teaserDe, form.teaserEn, 220);
  const body = localized(form.bodyDe, form.bodyEn, 4000);
  const details = localized(form.detailsDe, form.detailsEn, 400);
  if (
    title === "too-long" ||
    teaser === "too-long" ||
    body === "too-long" ||
    details === "too-long"
  ) {
    return { ok: false, error: "Ein Text ist zu lang." };
  }
  if (!title?.de) return { ok: false, error: "Bitte einen deutschen Titel angeben." };
  if (!teaser?.de) return { ok: false, error: "Bitte eine deutsche Kurzbeschreibung angeben." };
  if (!(HOUSE_SERVICE_CATEGORIES as readonly string[]).includes(form.category)) {
    return { ok: false, error: "Bitte eine Kategorie wählen." };
  }
  if (form.fulfillment !== "instant" && form.fulfillment !== "request") {
    return { ok: false, error: "Bitte die Buchungsart wählen." };
  }
  let cancellation: CancellationPolicy;
  if (form.cancellation === "free-until") {
    const hours = Number(form.cancellationHours);
    if (!Number.isInteger(hours) || hours < 0 || hours > 720) {
      return { ok: false, error: "Bitte die Stornofrist in Stunden (0–720) angeben." };
    }
    cancellation = { type: "free-until", hoursBefore: hours };
  } else if (form.cancellation === "non-refundable" || form.cancellation === "on-request") {
    cancellation = { type: form.cancellation };
  } else {
    return { ok: false, error: "Bitte die Stornobedingung wählen." };
  }
  const heroImage = parseHeroImage(form.heroImage, isAllowedImage);
  if (heroImage === "invalid")
    return { ok: false, error: "Das Bild konnte nicht übernommen werden." };
  return {
    ok: true,
    input: {
      title,
      teaser,
      body,
      details,
      category: form.category as OfferCategory,
      fulfillment: form.fulfillment,
      cancellation,
      heroImage,
      slug: { de: slugify(title.de), ...(title.en ? { en: slugify(title.en) } : {}) },
    },
  };
}

export async function createOffer(
  deps: CatalogDeps,
  admin: AdminContext,
  form: OfferForm,
): Promise<Result<{ id: string }>> {
  if (!isAllowed(admin, "catalog.edit")) return { ok: false, error: FORBIDDEN_MESSAGE };
  const parsed = parseOfferForm(form, (src) => deps.isAllowedImageSrc(src, admin.tenantId));
  if (!parsed.ok) return parsed;
  const id = await createCatalogOffer(deps.db, tenantOf(admin), {
    ...parsed.input,
    actorAdminId: admin.adminUserId,
  });
  return { ok: true, id };
}

export async function updateOffer(
  deps: CatalogDeps,
  admin: AdminContext,
  offerId: string,
  form: OfferForm,
): Promise<Result> {
  if (!isAllowed(admin, "catalog.edit")) return { ok: false, error: FORBIDDEN_MESSAGE };
  const parsed = parseOfferForm(form, (src) => deps.isAllowedImageSrc(src, admin.tenantId));
  if (!parsed.ok) return parsed;
  const saved = await updateCatalogOffer(deps.db, tenantOf(admin), offerId, {
    ...parsed.input,
    actorAdminId: admin.adminUserId,
  });
  return saved ? { ok: true } : { ok: false, error: "Diesen Service gibt es nicht." };
}

export async function changeOfferStatus(
  deps: CatalogDeps,
  admin: AdminContext,
  offerId: string,
  status: string,
): Promise<Result> {
  if (!isAllowed(admin, "catalog.edit")) return { ok: false, error: FORBIDDEN_MESSAGE };
  if (!(GUIDE_STATUSES as readonly string[]).includes(status))
    return { ok: false, error: "Ungültiger Status." };
  const saved = await setCatalogOfferStatus(deps.db, tenantOf(admin), {
    offerId,
    status: status as GuideStatus,
    actorAdminId: admin.adminUserId,
    now: deps.now(),
  });
  return saved ? { ok: true } : { ok: false, error: "Diesen Service gibt es nicht." };
}

/* ── Property configuration ───────────────────────────────────────────────────────────── */

export type PropertyConfigForm = {
  extrasServiceId: string;
  active: boolean;
  sortOrder: string;
  actionType: string;
  bookingRule: string;
  fulfillment: string;
  extraPersonPrice: string;
  priceUnitLabelDe: string;
  priceUnitLabelEn: string;
  requiresRemainingCapacity: boolean;
  requiresVehicleRegistration: boolean;
  maxOnePerReservation: boolean;
  allowedUnitGroupIds: string[];
  titleOverrideDe: string;
  titleOverrideEn: string;
  teaserOverrideDe: string;
  teaserOverrideEn: string;
  /** Only sent when the configuration still follows Extras' text logic (checkbox shown). */
  extrasTextsActive?: boolean;
};

const SERVICE_ID = /^[A-Za-z0-9_-]{1,120}$/;
const UNIT_GROUP_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function parsePropertyConfigForm(
  form: PropertyConfigForm,
): Result<{ config: PropertyConfigInput }> {
  const serviceId = form.extrasServiceId.trim();
  if (serviceId && !SERVICE_ID.test(serviceId))
    return { ok: false, error: "Ungültige Apaleo-Service-ID." };
  const actionType = form.actionType === "increase_occupancy" ? "increase_occupancy" : "service";
  const isOccupancy = actionType === "increase_occupancy";
  if (!(BOOKING_RULES as readonly string[]).includes(form.bookingRule)) {
    return { ok: false, error: "Bitte eine Buchungsregel wählen." };
  }
  const fulfillment = isOccupancy
    ? "instant"
    : form.fulfillment === "request"
      ? "request"
      : "instant";
  let extraPersonPriceCents: number | null = null;
  if (isOccupancy) {
    const parsed = parsePriceToCents(form.extraPersonPrice);
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0 || parsed > 10_000_000)) {
      return {
        ok: false,
        error: "Bitte einen gültigen Preis pro Person und Nacht angeben (z. B. 35 oder 35,50).",
      };
    }
    extraPersonPriceCents = parsed;
  }
  // Empty = "without order": after every numbered service, as in Extras.
  const sortOrder = form.sortOrder.trim() === "" ? SORT_ORDER_LAST : Number(form.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) {
    return { ok: false, error: "Die Reihenfolge ist eine ganze Zahl von 0 bis 9999." };
  }
  const groups = [...new Set(form.allowedUnitGroupIds.map((id) => id.trim()).filter(Boolean))];
  if (groups.length > 50 || groups.some((id) => !UNIT_GROUP_ID.test(id))) {
    return { ok: false, error: "Ungültige Apartmenttypen." };
  }
  const label = localized(form.priceUnitLabelDe, form.priceUnitLabelEn, 60);
  const title = localized(form.titleOverrideDe, form.titleOverrideEn, 120);
  const teaser = localized(form.teaserOverrideDe, form.teaserOverrideEn, 220);
  if (label === "too-long" || title === "too-long" || teaser === "too-long")
    return { ok: false, error: "Ein Text ist zu lang." };
  return {
    ok: true,
    config: {
      extrasServiceId: serviceId || null,
      active: form.active,
      sortOrder,
      actionType,
      bookingRule: form.bookingRule as PropertyConfigInput["bookingRule"],
      fulfillment,
      extraPersonPriceCents,
      priceUnitLabel: label,
      requiresRemainingCapacity: isOccupancy || form.requiresRemainingCapacity,
      requiresVehicleRegistration: form.requiresVehicleRegistration,
      maxOnePerReservation: form.maxOnePerReservation,
      allowedUnitGroupIds: groups,
      titleOverride: title,
      teaserOverride: teaser,
      ...(form.extrasTextsActive === undefined
        ? {}
        : { extrasTextsActive: form.extrasTextsActive }),
    },
  };
}

export type ConfigSaveOutcome = Result<{ issues: ServiceConfigIssue[]; created: boolean }>;

/** Saves; configuration errors (e.g. additional guest without price) are allowed but flagged. */
export async function saveConfig(
  deps: CatalogDeps,
  admin: AdminContext,
  offerId: string,
  propertyId: string,
  form: PropertyConfigForm,
): Promise<ConfigSaveOutcome> {
  if (!isAllowed(admin, "catalog.edit", { propertyId }))
    return { ok: false, error: FORBIDDEN_MESSAGE };
  const parsed = parsePropertyConfigForm(form);
  if (!parsed.ok) return parsed;
  const result = await savePropertyConfig(deps.db, tenantOf(admin), {
    offerId,
    propertyId,
    config: parsed.config,
    actorAdminId: admin.adminUserId,
    now: deps.now(),
  });
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "service-in-use"
          ? "Dieser Apaleo-Service ist an diesem Objekt schon einem anderen Service zugeordnet."
          : "Service oder Objekt gibt es nicht.",
    };
  }
  return { ok: true, created: result.created, issues: serviceConfigIssues(parsed.config) };
}

export async function removeConfig(
  deps: CatalogDeps,
  admin: AdminContext,
  offerId: string,
  propertyId: string,
): Promise<Result> {
  if (!isAllowed(admin, "catalog.edit", { propertyId }))
    return { ok: false, error: FORBIDDEN_MESSAGE };
  const removed = await removePropertyConfig(deps.db, tenantOf(admin), {
    offerId,
    propertyId,
    actorAdminId: admin.adminUserId,
  });
  return removed ? { ok: true } : { ok: false, error: "Diese Zuordnung gibt es nicht." };
}

export function emptyConfig(): CatalogPropertyConfig {
  return {
    propertyId: "",
    extrasServiceId: null,
    active: true,
    sortOrder: 0,
    actionType: "service",
    bookingRule: "per_stay",
    fulfillment: "instant",
    extraPersonPriceCents: null,
    currency: null,
    extrasTextsActive: false,
    priceUnitLabel: null,
    requiresRemainingCapacity: false,
    requiresVehicleRegistration: false,
    maxOnePerReservation: false,
    allowedUnitGroupIds: [],
    titleOverride: null,
    teaserOverride: null,
    legacyKey: null,
    importedAt: null,
    updatedAt: new Date(0),
  };
}
