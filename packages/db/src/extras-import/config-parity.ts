/**
 * Configuration parity Extras → STAY (before M5): field by field, per property and service.
 *
 * For every stored Extras setting the report holds
 *   - the stored original value,
 *   - what Extras actually does with it (reproduced from its code, @up/core extras-semantics),
 *   - what the STAY import stores (the same functions the import uses),
 *   - what STAY does with that,
 *   - a category: identical | intended | missing | faulty | unverified.
 *
 * Pure – reads only the snapshot. No database, no Apaleo, no personal data in the output
 * (history is counted, never listed; users only by role).
 *
 * "identical" means: value and effect are the same by construction and covered by tests. Effects
 * that depend on live Apaleo data (texts shown, availability) are still "identical" in logic;
 * the report says so in `basis`. A run on synthetic data is marked as such and is never a proof
 * of the production configuration.
 */
import {
  extrasActionType,
  extrasBookingRule,
  extrasExtensionConfig,
  extrasExtensionEffectivelyEnabled,
  extrasExtraPersonPrice,
  extrasFulfillmentReach,
  extrasSortKey,
  extrasTruthy,
  extrasUnitGroupRestriction,
  SORT_ORDER_LAST,
} from "@up/core";

import { externalImageReferences, planImageMigration } from "./images";
import {
  catalogMembers,
  configWithWarnings,
  type ExtrasSnapshotLike,
  groupKeyOf,
  mapExtensionSettings,
  UNMATCHABLE_UNIT_GROUP,
} from "./importer";

export type ParityCategory = "identical" | "intended" | "missing" | "faulty" | "unverified";

export const PARITY_CATEGORY_LABELS: Record<ParityCategory, string> = {
  identical: "Identisch",
  intended: "Bewusst abweichend",
  missing: "Fehlt",
  faulty: "Fehlerhaft",
  unverified: "Nicht verifiziert",
};

export type FieldParity = {
  field: string;
  /** Stored original value (JSON; long texts shortened). Absent field = "(fehlt)". */
  stored: unknown;
  extrasEffect: unknown;
  stayValue: unknown;
  stayEffect: unknown;
  category: ParityCategory;
  /** Short reason code, e.g. "p1_boolean", "unmatchable_kept_restricted". */
  reason?: string;
};

export type ServiceParity = {
  serviceId: string;
  code: string;
  offerGroup: string;
  fields: FieldParity[];
  importWarnings: string[];
};

export type PropertyParity = {
  apaleoPropertyId: string;
  services: ServiceParity[];
  extension: { fields: FieldParity[]; importWarnings: string[] } | null;
  /** Visible order of active services, Extras vs STAY (identical when both lists match). */
  order: { extras: string[]; stay: string[]; category: ParityCategory };
};

export type ConfigParityReport = {
  basis: "m0-export" | "synthetic";
  snapshotSha256: string | null;
  generatedAt: string;
  summary: Record<ParityCategory, number>;
  properties: PropertyParity[];
  affected: {
    p1: { reference: string; field: string; stored: unknown }[];
    p2: { reference: string; stored: unknown; extras: number | null; stay: number | null }[];
    p4: { reference: string }[];
    extensionEffect: { apaleoPropertyId: string; reason: string }[];
  };
  unknownFields: { reference: string; field: string }[];
  images: {
    planned: number;
    issues: { imageId: string; issues: string[]; references: string[] }[];
    external: { reference: string; url: string }[];
  };
  operations: {
    keys: Record<string, number>;
    users: Record<string, number>;
    orders: number;
    requests: Record<string, number>;
    /** Per request with something not reconstructable: id, status, issue codes (no guest data). */
    requestIssues: { requestId: string; status: string; issues: string[] }[];
    extensionRecords: number;
    findings: { area: string; category: ParityCategory; note: string }[];
  };
};

/** Every field the Extras admin route writes or Extras reads (app/api/admin/catalog/route.js). */
const KNOWN_ITEM_FIELDS = new Set([
  "serviceId",
  "code",
  "name",
  "displayName",
  "description",
  "category",
  "imageUrl",
  "active",
  "bookingRule",
  "priceUnitLabel",
  "fulfillmentMode",
  "actionType",
  "extraPersonPricePerNight",
  "displayNameDe",
  "displayNameEn",
  "descriptionDe",
  "descriptionEn",
  "priceUnitLabelDe",
  "priceUnitLabelEn",
  "allowedUnitGroupIds",
  "sortOrder",
  "requiresRemainingCapacity",
  "requiresVehicleRegistration",
  "maxOnePerReservation",
  "updatedAt",
]);

const KNOWN_EXTENSION_FIELDS = new Set([
  "extensionNightEnabled",
  "extensionDiscountOneNightGap",
  "extensionDiscountStandard",
  "extensionDiscountPreArrivalOneNightGap",
  "extensionDiscountPreArrivalStandard",
  "extensionDiscountInHouseOneNightGap",
  "extensionDiscountInHouseStandard",
  "minSellableStayNights",
  "updatedAt",
]);

const ABSENT = "(fehlt)";
const shown = (item: Record<string, unknown>, key: string): unknown => {
  if (!(key in item)) return ABSENT;
  const value = item[key];
  return typeof value === "string" && value.length > 120 ? `${value.slice(0, 117)}…` : value;
};
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function serviceParity(
  item: Record<string, unknown>,
  imageState: Map<string, string[]>,
  reference: string,
  affected: ConfigParityReport["affected"],
): ServiceParity {
  const { config, warnings } = configWithWarnings(item);
  const fields: FieldParity[] = [];
  const push = (entry: FieldParity) => fields.push(entry);

  push({
    field: "serviceId",
    stored: shown(item, "serviceId"),
    extrasEffect: "Apaleo-Service",
    stayValue: config.extrasServiceId,
    stayEffect: "Apaleo-Service",
    category: config.extrasServiceId === item.serviceId ? "identical" : "faulty",
  });
  push({
    field: "code",
    stored: shown(item, "code"),
    extrasEffect: "letzter Titel-Rückfall",
    stayValue: groupKeyOf(item),
    stayEffect: "Angebotsgruppe (gleicher Code = ein Angebot) und letzter Titel-Rückfall",
    category: "identical",
  });

  // Booleans – P-1.
  for (const key of [
    "active",
    "requiresRemainingCapacity",
    "requiresVehicleRegistration",
    "maxOnePerReservation",
  ] as const) {
    const extras = extrasTruthy(item[key]);
    const stay = config[key];
    const forced =
      key === "requiresRemainingCapacity" && config.actionType === "increase_occupancy";
    const hiddenByMode =
      key === "active" && warnings.includes("unknown_fulfillment_hidden_in_extras");
    const p1 = warnings.includes(`p1_boolean_differs:${key}`);
    if (p1) affected.p1.push({ reference, field: key, stored: item[key] });
    push({
      field: key,
      stored: shown(item, key),
      extrasEffect: extras,
      stayValue: stay,
      stayEffect: stay,
      category: p1
        ? "intended"
        : forced || hiddenByMode || extras === stay
          ? extras === stay
            ? "identical"
            : "intended"
          : "faulty",
      ...(p1 ? { reason: "p1_boolean" } : {}),
      ...(forced && !extras ? { reason: "occupancy_always_capacity_gated" } : {}),
      ...(hiddenByMode ? { reason: "hidden_in_extras_by_unknown_mode" } : {}),
    });
  }

  const extrasAction = extrasActionType(item.actionType);
  push({
    field: "actionType",
    stored: shown(item, "actionType"),
    extrasEffect: extrasAction,
    stayValue: config.actionType,
    stayEffect: config.actionType,
    category: extrasAction === config.actionType ? "identical" : "faulty",
  });

  const extrasRule = extrasBookingRule(item.bookingRule);
  const unknownRule = warnings.includes("unknown_booking_rule");
  push({
    field: "bookingRule",
    stored: shown(item, "bookingRule"),
    extrasEffect: extrasRule,
    stayValue: config.bookingRule,
    stayEffect: config.bookingRule,
    category: extrasRule !== config.bookingRule ? "faulty" : unknownRule ? "intended" : "identical",
    ...(unknownRule ? { reason: "unknown_rule_label_default" } : {}),
  });

  const reach = extrasFulfillmentReach(item.fulfillmentMode);
  const stayReach = config.active ? config.fulfillment : "hidden";
  const extrasReach =
    extrasAction === "increase_occupancy" && reach !== "hidden" ? "instant" : reach;
  push({
    field: "fulfillmentMode",
    stored: shown(item, "fulfillmentMode"),
    extrasEffect: reach,
    stayValue: config.fulfillment,
    stayEffect: reach === "hidden" ? stayReach : config.fulfillment,
    category:
      reach === "hidden"
        ? stayReach === "hidden"
          ? "intended"
          : "faulty"
        : extrasReach === config.fulfillment
          ? extrasReach === reach
            ? "identical"
            : "intended"
          : "faulty",
    ...(reach === "hidden" ? { reason: "unknown_mode_imported_inactive" } : {}),
    ...(extrasReach !== reach ? { reason: "occupancy_always_instant" } : {}),
  });
  if (config.active && config.fulfillment === "request") affected.p4.push({ reference });

  if (config.actionType === "increase_occupancy") {
    const extras = extrasExtraPersonPrice(item.extraPersonPricePerNight);
    const stay = config.extraPersonPriceCents;
    const extrasCents = extras === null ? null : Math.round(extras * 100);
    const differs = extrasCents !== stay;
    if (differs)
      affected.p2.push({
        reference,
        stored: "extraPersonPricePerNight" in item ? item.extraPersonPricePerNight : ABSENT,
        extras,
        stay: stay === null ? null : stay / 100,
      });
    push({
      field: "extraPersonPricePerNight",
      stored: shown(item, "extraPersonPricePerNight"),
      extrasEffect: extras === null ? "ausgeblendet" : `${extras.toFixed(2)} € pro Person/Nacht`,
      stayValue: stay,
      stayEffect:
        stay === null
          ? "nicht buchbar (Konfigurationsfehler)"
          : `${(stay / 100).toFixed(2)} € pro Person/Nacht`,
      category: differs ? "intended" : "identical",
      ...(differs ? { reason: "p2_price" } : {}),
    });
  }

  const groups = extrasUnitGroupRestriction(item.allowedUnitGroupIds);
  const stayGroups = config.allowedUnitGroupIds;
  const sameGroups = !groups.restricted
    ? stayGroups.length === 0
    : stayGroups.includes(UNMATCHABLE_UNIT_GROUP)
      ? groups.allowed.filter((id) => /^[A-Za-z0-9_-]{1,80}$/.test(id.trim())).length === 0
      : groups.allowed.every(
          (id) => !/^[A-Za-z0-9_-]{1,80}$/.test(id.trim()) || stayGroups.includes(id.trim()),
        );
  const truncated = warnings.includes("unit_group_ids_truncated");
  push({
    field: "allowedUnitGroupIds",
    stored: shown(item, "allowedUnitGroupIds"),
    extrasEffect: groups.restricted
      ? `nur ${groups.allowed.join(", ") || "(keiner)"}`
      : "alle Apartmenttypen",
    stayValue: stayGroups,
    stayEffect:
      stayGroups.length === 0
        ? "alle Apartmenttypen"
        : stayGroups.includes(UNMATCHABLE_UNIT_GROUP)
          ? "kein Apartmenttyp (wie Extras)"
          : `nur ${stayGroups.join(", ")}`,
    category:
      truncated || !sameGroups
        ? "faulty"
        : warnings.includes("unit_groups_unmatchable_kept_restricted") ||
            warnings.includes("invalid_unit_group_ids_dropped")
          ? "intended"
          : "identical",
    ...(truncated ? { reason: "more_than_50_groups" } : {}),
  });

  const extrasSort = extrasSortKey(item.sortOrder);
  const sortWarn = warnings.find((w) => w.startsWith("sort_order_"));
  push({
    field: "sortOrder",
    stored: shown(item, "sortOrder"),
    extrasEffect: Number.isFinite(extrasSort) ? extrasSort : "ohne Reihenfolge (am Ende)",
    stayValue: config.sortOrder,
    stayEffect:
      config.sortOrder === SORT_ORDER_LAST ? "ohne Reihenfolge (am Ende)" : config.sortOrder,
    // Kept exactly (decimals included); only an order beyond ±1e9 has to be clamped.
    category: sortWarn === "sort_order_clamped" ? "faulty" : "identical",
    ...(sortWarn ? { reason: sortWarn } : {}),
  });

  // Texts: carried verbatim; guests see Extras' own resolution with live Apaleo texts.
  for (const key of [
    "displayName",
    "displayNameDe",
    "displayNameEn",
    "description",
    "descriptionDe",
    "descriptionEn",
    "priceUnitLabel",
    "priceUnitLabelDe",
    "priceUnitLabelEn",
  ]) {
    if (!(key in item)) continue;
    push({
      field: key,
      stored: shown(item, key),
      extrasEffect: "Extras-Textlogik (eigener Text → Apaleo → allgemeiner Text)",
      stayValue: "unverändert in extras_texts",
      stayEffect: "dieselbe Textlogik bis zur ersten Textänderung in STAY",
      category: "identical",
    });
  }
  if ("name" in item)
    push({
      field: "name",
      stored: shown(item, "name"),
      extrasEffect: "ohne Wirkung für Gäste (Apaleo-Name beim Speichern)",
      stayValue: "Rückfall für den STAY-Titel",
      stayEffect: "ohne Wirkung, solange die Extras-Textlogik aktiv ist",
      category: "identical",
    });
  if ("category" in item)
    push({
      field: "category",
      stored: shown(item, "category"),
      extrasEffect: "ohne Wirkung für Gäste (nur im Extras-Admin)",
      stayValue: "STAY-Kategorie aus Regeln abgeleitet",
      stayEffect: "Gruppierung in der STAY-Oberfläche",
      category: "intended",
      reason: "free_text_category_not_used_by_guests",
    });

  if ("imageUrl" in item && typeof item.imageUrl === "string" && item.imageUrl.trim()) {
    const issues = imageState.get(reference);
    const external = issues === undefined;
    push({
      field: "imageUrl",
      stored: shown(item, "imageUrl"),
      extrasEffect: "Bild",
      stayValue: external ? "nicht übernommen (externe Adresse)" : "Bildmigration",
      stayEffect: external
        ? "kein Bild"
        : issues.length
          ? `Bild problematisch: ${issues.join(", ")}`
          : "Bild (nach Migration)",
      category: external
        ? "missing"
        : issues.some((i) => i !== "unreferenced")
          ? "faulty"
          : "identical",
      ...(external ? { reason: "external_image_url" } : {}),
    });
  }

  return {
    serviceId: String(item.serviceId),
    code: typeof item.code === "string" ? item.code : "",
    offerGroup: groupKeyOf(item),
    fields,
    importWarnings: warnings,
  };
}

function extensionParity(
  apaleoPropertyId: string,
  stored: Record<string, unknown>,
  affected: ConfigParityReport["affected"],
): { fields: FieldParity[]; importWarnings: string[] } {
  const extras = extrasExtensionConfig(stored);
  const { values, notes } = mapExtensionSettings(stored);
  const fields: FieldParity[] = [];
  const effectiveExtras = extrasExtensionEffectivelyEnabled(extras);
  const p1 = notes.includes("p1_boolean_differs:extensionNightEnabled");
  fields.push({
    field: "extensionNightEnabled",
    stored: shown(stored, "extensionNightEnabled"),
    extrasEffect: effectiveExtras
      ? "Angebot möglich"
      : extras.extensionNightEnabled
        ? "kein Angebot (Mindestbelegung ungültig)"
        : "aus",
    stayValue: values.extensionNightEnabled,
    stayEffect: values.extensionNightEnabled ? "Angebot möglich" : "aus",
    category: p1
      ? "intended"
      : effectiveExtras === values.extensionNightEnabled
        ? extras.extensionNightEnabled === values.extensionNightEnabled
          ? "identical"
          : "intended"
        : "faulty",
    ...(p1 ? { reason: "p1_boolean" } : {}),
    ...(!p1 && extras.extensionNightEnabled !== values.extensionNightEnabled
      ? { reason: "invalid_min_in_extras_imported_off" }
      : {}),
  });
  if (p1)
    affected.p1.push({
      reference: `${apaleoPropertyId}:extension`,
      field: "extensionNightEnabled",
      stored: stored.extensionNightEnabled,
    });
  if (notes.includes("extension_off_invalid_min_in_extras"))
    affected.extensionEffect.push({ apaleoPropertyId, reason: "invalid_min_in_extras" });

  const pairs = [
    ["extensionDiscountPreArrivalOneNightGap", "discountPreArrivalOneNightGap"],
    ["extensionDiscountPreArrivalStandard", "discountPreArrivalStandard"],
    ["extensionDiscountInHouseOneNightGap", "discountInHouseOneNightGap"],
    ["extensionDiscountInHouseStandard", "discountInHouseStandard"],
  ] as const;
  for (const [key, column] of pairs) {
    const changed = notes.some(
      (n) => n === `discount_rounded:${key}` || n === `discount_clamped:${key}`,
    );
    const legacy = notes.find((n) => n.startsWith(`legacy_discount:${key}`));
    if (changed)
      affected.extensionEffect.push({ apaleoPropertyId, reason: `discount_changed:${key}` });
    fields.push({
      field: key,
      stored: shown(stored, key),
      extrasEffect: `${String(extras[key])} %`,
      stayValue: values[column],
      stayEffect: `${String(values[column])} %`,
      // The legacy flat field has the same effect in Extras – identical, with the source noted.
      category: changed ? "faulty" : "identical",
      ...(changed ? { reason: "discount_rounded_or_clamped" } : {}),
      ...(legacy ? { reason: "legacy_flat_field" } : {}),
    });
  }
  const minChanged = notes.includes("min_nights_clamped");
  fields.push({
    field: "minSellableStayNights",
    stored: shown(stored, "minSellableStayNights"),
    extrasEffect:
      extras.minSellableStayNights >= 1
        ? `Angebot bei Lücke 1 oder > ${String(extras.minSellableStayNights)}`
        : "ungültig – kein Angebot",
    stayValue: values.minSellableStayNights,
    stayEffect: `Angebot bei Lücke 1 oder > ${String(values.minSellableStayNights)}`,
    category: minChanged
      ? "faulty"
      : extras.minSellableStayNights === values.minSellableStayNights
        ? "identical"
        : "intended",
    ...(minChanged ? { reason: "min_nights_clamped" } : {}),
  });
  for (const legacyKey of ["extensionDiscountOneNightGap", "extensionDiscountStandard"]) {
    if (!(legacyKey in stored)) continue;
    fields.push({
      field: legacyKey,
      stored: shown(stored, legacyKey),
      extrasEffect: "Rückfall für nicht gespeicherte Phasen-Rabatte",
      stayValue: "in die vier Phasen-Rabatte übernommen",
      stayEffect: "wie Extras",
      category: "identical",
    });
  }
  return { fields, importWarnings: notes };
}

/**
 * What the import cannot take over 1:1 for one Extras request (same rules as the import):
 * the request is always kept – as history on an archived offer if its service is gone.
 */
export function requestHistoryIssues(
  r: Record<string, unknown>,
  catalogByProperty: Map<string, Map<string, Record<string, unknown>>>,
): string[] {
  const issues: string[] = [];
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const status = text(r.status);
  if (!text(r.requestId) || !["pending", "approved", "rejected"].includes(status))
    return ["invalid_record_skipped"];
  if (!text(r.reservationId)) return ["missing_reservation_skipped"];
  const catalog = catalogByProperty.get(text(r.propertyId));
  if (!catalog) issues.push("property_without_catalog_check_mapping");
  const item = catalog?.get(text(r.serviceId));
  if (!item) issues.push("service_removed_archived_offer");
  else if (!extrasTruthy(item.active)) issues.push("service_inactive");
  if (!text(r.serviceName)) issues.push("service_name_missing");
  if (status !== "pending") {
    const at = text(status === "approved" ? r.approvedAt : r.rejectedAt);
    if (!at || Number.isNaN(Date.parse(at))) issues.push("decision_time_missing");
  }
  if (!text(r.departureDate)) issues.push("departure_missing");
  const qty = Number(r.requestedQuantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 50) issues.push("quantity_adjusted");
  return issues;
}

export function compareExtrasConfiguration(
  snapshot: ExtrasSnapshotLike,
  options: { basis: "m0-export" | "synthetic"; snapshotSha256?: string | null; now?: Date },
): ConfigParityReport {
  const affected: ConfigParityReport["affected"] = { p1: [], p2: [], p4: [], extensionEffect: [] };
  const unknownFields: ConfigParityReport["unknownFields"] = [];

  const plan = planImageMigration(snapshot);
  const external = externalImageReferences(snapshot);
  const imageState = new Map<string, string[]>();
  for (const image of plan) for (const ref of image.references) imageState.set(ref, image.issues);

  const byProperty = new Map<string, Record<string, unknown>[]>();
  for (const { apaleoPropertyId, item } of catalogMembers(snapshot)) {
    const list = byProperty.get(apaleoPropertyId) ?? [];
    list.push(item);
    byProperty.set(apaleoPropertyId, list);
  }
  const extensionByProperty = new Map<string, Record<string, unknown>>();
  for (const entry of snapshot.entries) {
    const match = /^extension-night:config:([^:]+)$/.exec(entry.key);
    if (match?.[1]) extensionByProperty.set(match[1], obj(entry.value));
  }

  const propertyIds = [...new Set([...byProperty.keys(), ...extensionByProperty.keys()])].sort();
  const properties: PropertyParity[] = propertyIds.map((apaleoPropertyId) => {
    const items = byProperty.get(apaleoPropertyId) ?? [];
    const services = items.map((item) => {
      const reference = `${apaleoPropertyId}:${String(item.serviceId)}`;
      for (const key of Object.keys(item))
        if (!KNOWN_ITEM_FIELDS.has(key)) unknownFields.push({ reference, field: key });
      return serviceParity(item, imageState, reference, affected);
    });
    services.sort((a, b) => a.serviceId.localeCompare(b.serviceId));
    const extensionStored = extensionByProperty.get(apaleoPropertyId);
    if (extensionStored)
      for (const key of Object.keys(extensionStored))
        if (!KNOWN_EXTENSION_FIELDS.has(key))
          unknownFields.push({ reference: `${apaleoPropertyId}:extension`, field: key });

    // Visible order: Extras sorts active items by extrasSortKey (stable, snapshot order);
    // STAY by sort_order, then age of the configuration (= snapshot order on first import).
    const indexed = items.map((item, index) => ({
      item,
      index,
      config: configWithWarnings(item).config,
    }));
    const extrasOrder = indexed
      .filter(
        ({ item }) =>
          extrasTruthy(item.active) && extrasFulfillmentReach(item.fulfillmentMode) !== "hidden",
      )
      .sort(
        (a, b) =>
          extrasSortKey(a.item.sortOrder) - extrasSortKey(b.item.sortOrder) || a.index - b.index,
      )
      .map(({ item }) => String(item.serviceId));
    const stayOrder = indexed
      .filter(({ config }) => config.active)
      .sort((a, b) => a.config.sortOrder - b.config.sortOrder || a.index - b.index)
      .map(({ item }) => String(item.serviceId));
    const extrasVisibleInStay = extrasOrder.filter((id) => stayOrder.includes(id));
    const stayVisibleInExtras = stayOrder.filter((id) => extrasOrder.includes(id));
    const ties = indexed.some((a) =>
      indexed.some(
        (b) =>
          a !== b &&
          a.config.active &&
          b.config.active &&
          a.config.sortOrder === b.config.sortOrder,
      ),
    );
    return {
      apaleoPropertyId,
      services,
      extension: extensionStored
        ? extensionParity(apaleoPropertyId, extensionStored, affected)
        : null,
      order: {
        extras: extrasOrder,
        stay: stayOrder,
        category:
          JSON.stringify(extrasVisibleInStay) !== JSON.stringify(stayVisibleInExtras)
            ? "faulty"
            : ties
              ? "unverified"
              : "identical",
      },
    };
  });

  const summary: Record<ParityCategory, number> = {
    identical: 0,
    intended: 0,
    missing: 0,
    faulty: 0,
    unverified: 0,
  };
  for (const property of properties) {
    for (const service of property.services)
      for (const f of service.fields) summary[f.category] += 1;
    for (const f of property.extension?.fields ?? []) summary[f.category] += 1;
    summary[property.order.category] += 1;
  }
  for (const _ of unknownFields) summary.unverified += 1;

  // Operations: what exists besides catalog and extension config.
  const keys: Record<string, number> = {};
  let users: unknown[] = [];
  let orders = 0;
  let extensionRecords = 0;
  const requests: Record<string, number> = {};
  const requestIssues: ConfigParityReport["operations"]["requestIssues"] = [];
  const catalogByProperty = new Map<string, Map<string, Record<string, unknown>>>();
  for (const { apaleoPropertyId, item } of catalogMembers(snapshot)) {
    const map =
      catalogByProperty.get(apaleoPropertyId) ?? new Map<string, Record<string, unknown>>();
    map.set(String(item.serviceId), item);
    catalogByProperty.set(apaleoPropertyId, map);
  }
  for (const entry of snapshot.entries) {
    const family = entry.key
      .replace(/:[^:]*$/, ":*")
      .replace(/^(catalog|extension-night:config|image):.*$/, "$1:*");
    keys[family] = (keys[family] ?? 0) + 1;
    if (entry.key === "users" && Array.isArray(entry.value)) users = entry.value;
    if (entry.key === "orders" && Array.isArray(entry.value)) orders = entry.value.length;
    if (entry.key === "stay-extensions:records")
      extensionRecords = Object.keys(obj(entry.value)).length;
    if (entry.key === "requests:items")
      for (const record of Object.values(obj(entry.value))) {
        const r = obj(record);
        const raw = r.status;
        const status = typeof raw === "string" && raw ? raw : "unbekannt";
        requests[status] = (requests[status] ?? 0) + 1;
        const issues = requestHistoryIssues(r, catalogByProperty);
        if (issues.length)
          requestIssues.push({
            requestId: typeof r.requestId === "string" ? r.requestId.slice(0, 100) : "(ohne ID)",
            status,
            issues,
          });
      }
  }
  const roles: Record<string, number> = {};
  for (const user of users) {
    const raw = obj(user).role;
    const role = typeof raw === "string" && raw ? raw : "unbekannt";
    roles[role] = (roles[role] ?? 0) + 1;
  }
  const requestProperties = new Set(affected.p4.map((p) => p.reference.split(":")[0]));
  const findings: ConfigParityReport["operations"]["findings"] = [
    {
      area: "Slack",
      category: "missing",
      note: `Extras sendet alle neuen Anfragen an EINEN Webhook (Umgebungsvariable, nicht im Export). In STAY braucht jeder Standort mit Anfrage-Services ein Slack-Ziel: ${[...requestProperties].sort().join(", ") || "keiner"}. Wird beim Go-live gesetzt (Import-Option --slack-route).`,
    },
    {
      area: "Benutzer und Rollen",
      category: "intended",
      note: "Extras: globale Rollen admin/manager/viewer ohne Standortrechte, Passwort-Hashes. STAY: Einladungen mit Rolle und Standortrechten; Passwörter werden nie übernommen.",
    },
    {
      area: "Veröffentlichung",
      category: "intended",
      note: "Neue Angebote entstehen als Entwurf; erst die Veröffentlichung beim Go-live macht sie für Gäste sichtbar (Prüfliste).",
    },
    {
      area: "Bestellhistorie",
      category: "intended",
      note: "Extras behält nur die letzten 500 Bestellungen (ältere sind dort bereits verloren). STAY übernimmt alle vorhandenen ohne Gastnamen.",
    },
  ];

  return {
    basis: options.basis,
    snapshotSha256: options.snapshotSha256 ?? null,
    generatedAt: (options.now ?? new Date()).toISOString(),
    summary,
    properties,
    affected,
    unknownFields,
    images: {
      planned: plan.length,
      issues: plan
        .filter((p) => p.issues.length)
        .map((p) => ({ imageId: p.imageId, issues: p.issues, references: p.references })),
      external,
    },
    operations: {
      keys,
      users: roles,
      orders,
      requests,
      requestIssues: requestIssues.sort((a, b) => a.requestId.localeCompare(b.requestId)),
      extensionRecords,
      findings,
    },
  };
}

const cell = (value: unknown): string => {
  const text =
    value === undefined ? "–" : typeof value === "string" ? value : JSON.stringify(value);
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
};

/** Human-readable version of the report (German, for the acceptance documents). */
export function renderConfigParityMarkdown(report: ConfigParityReport): string {
  const L = PARITY_CATEGORY_LABELS;
  const lines: string[] = [
    "# Konfigurationsparität Extras → STAY (maschinell erzeugt)",
    "",
    `Grundlage: **${report.basis === "m0-export" ? "produktiver M0-Export (lesend)" : "synthetische Testdaten – KEIN Nachweis der produktiven Konfiguration"}**`,
    `Snapshot: ${report.snapshotSha256 ?? "–"} · erzeugt ${report.generatedAt}`,
    "",
    "| Kategorie | Anzahl |",
    "| --- | --- |",
    ...(Object.keys(L) as ParityCategory[]).map(
      (c) => `| ${L[c]} | ${String(report.summary[c])} |`,
    ),
    "",
  ];
  const nonIdentical = (fields: FieldParity[]) => fields.filter((f) => f.category !== "identical");
  for (const property of report.properties) {
    lines.push(`## Standort ${property.apaleoPropertyId}`, "");
    lines.push(
      `Reihenfolge: ${L[property.order.category]} – Extras: ${property.order.extras.join(", ") || "–"} · STAY: ${property.order.stay.join(", ") || "–"}`,
      "",
    );
    lines.push(
      "| Service | Feld | Gespeichert | Wirkung Extras | Wert STAY | Wirkung STAY | Kategorie | Grund |",
    );
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    let rows = 0;
    for (const service of property.services)
      for (const f of nonIdentical(service.fields)) {
        rows += 1;
        lines.push(
          `| ${cell(service.serviceId)} | ${f.field} | ${cell(f.stored)} | ${cell(f.extrasEffect)} | ${cell(f.stayValue)} | ${cell(f.stayEffect)} | ${L[f.category]} | ${f.reason ?? "–"} |`,
        );
      }
    for (const f of nonIdentical(property.extension?.fields ?? [])) {
      rows += 1;
      lines.push(
        `| (Verlängerungsnacht) | ${f.field} | ${cell(f.stored)} | ${cell(f.extrasEffect)} | ${cell(f.stayValue)} | ${cell(f.stayEffect)} | ${L[f.category]} | ${f.reason ?? "–"} |`,
      );
    }
    if (!rows) lines.push("| – | – | – | – | – | – | alle Felder identisch | – |");
    const identical =
      property.services.reduce(
        (n, s) => n + s.fields.filter((f) => f.category === "identical").length,
        0,
      ) + (property.extension?.fields.filter((f) => f.category === "identical").length ?? 0);
    lines.push(
      "",
      `Identische Felder an diesem Standort: ${String(identical)} (vollständige Liste im JSON).`,
      "",
    );
  }
  lines.push("## Betroffene Konfigurationen", "");
  lines.push(
    `- P-1 (Wahrheitswerte): ${report.affected.p1.map((p) => `${p.reference} ${p.field}=${JSON.stringify(p.stored)}`).join("; ") || "keine"}`,
  );
  lines.push(
    `- P-2 (Zusatzpersonenpreis): ${report.affected.p2.map((p) => `${p.reference} gespeichert ${JSON.stringify(p.stored)} → Extras ${p.extras ?? "ausgeblendet"} / STAY ${p.stay ?? "gesperrt"}`).join("; ") || "keine"}`,
  );
  lines.push(
    `- P-4 (Anfrage-Services, Prüfung schon beim Anlegen): ${report.affected.p4.map((p) => p.reference).join(", ") || "keine"}`,
  );
  lines.push(
    `- Verlängerungsnacht mit geänderter Wirkung: ${report.affected.extensionEffect.map((e) => `${e.apaleoPropertyId} (${e.reason})`).join(", ") || "keine"}`,
  );
  lines.push(
    `- Unbekannte Felder: ${report.unknownFields.map((u) => `${u.reference}.${u.field}`).join(", ") || "keine"}`,
  );
  lines.push("", "## Bilder", "");
  lines.push(
    `Geplant: ${String(report.images.planned)} · mit Hinweisen: ${String(report.images.issues.length)} · externe Adressen: ${String(report.images.external.length)}`,
  );
  for (const issue of report.images.issues)
    lines.push(
      `- ${issue.imageId.slice(0, 8)}: ${issue.issues.join(", ")} (${issue.references.join(", ") || "nicht verwendet"})`,
    );
  for (const ext of report.images.external) lines.push(`- extern: ${ext.reference}`);
  lines.push("", "## Betrieb", "");
  lines.push(
    `Benutzer je Rolle: ${JSON.stringify(report.operations.users)} · Bestellungen: ${String(report.operations.orders)} · Anfragen: ${JSON.stringify(report.operations.requests)} · Verlängerungen: ${String(report.operations.extensionRecords)}`,
  );
  lines.push(
    "",
    `Anfragen mit nicht vollständig rekonstruierbaren Angaben: ${String(report.operations.requestIssues.length)}`,
  );
  for (const r of report.operations.requestIssues)
    lines.push(`- ${r.requestId} (${r.status}): ${r.issues.join(", ")}`);
  for (const f of report.operations.findings)
    lines.push(`- **${f.area}** (${L[f.category]}): ${f.note}`);
  return `${lines.join("\n")}\n`;
}
