/**
 * Extras import and reconciliation (M1-D): repeatable import of an Extras snapshot (M0) into
 * the STAY model – dry run or apply, idempotent, with conflict detection and a report.
 *
 * Rules
 * - Every Extras property must be mapped to a STAY property (external_mappings, apaleo);
 *   unmapped data is skipped and reported, never guessed.
 * - One central catalog: Extras items with the same service code become ONE offer
 *   (legacy key "extras:<code>") with one property configuration each. Existing STAY offers
 *   that already reference the Apaleo service are linked, not duplicated.
 * - STAY data is never overwritten silently: STAY texts and media stay untouched; a
 *   configuration changed in STAY after the last import is reported as a conflict and kept.
 *   New offers are created as drafts – publishing is an admin decision.
 * - History (orders, requests, extensions) is inserted once per Extras id, without guest
 *   names or e-mail addresses. Users only produce invitation candidates (no passwords).
 * - Dry run and apply execute the same code; the dry run rolls back its transaction.
 */
import { createHash } from "node:crypto";

import {
  canonicalJson,
  DEFAULT_AVAILABILITY,
  normalizeBoolean,
  parsePriceToCents,
  resolveStayExtensionSettingsDetailed,
  serviceConfigIssues,
  type OfferCategory,
  type TenantContext,
} from "@up/core";
import { and, eq, inArray } from "drizzle-orm";

import { type Database } from "../client";
import {
  migrationItems,
  migrationRuns,
  offerProperties,
  offerRequests,
  offers,
  propertyServiceSettings,
  serviceBookingItems,
  serviceBookings,
  stayExtensions,
} from "../schema";
import { recordAdminAuditEvent } from "../repositories/audit-repository";
import { resolveExternalMapping } from "../repositories/tenancy-repository";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Obj = Record<string, unknown>;

export type ExtrasSnapshotLike = {
  entries: readonly { key: string; type: string; value: unknown }[];
};

export type ImportAction = "create" | "update" | "unchanged" | "conflict" | "skip" | "error";
export type ImportItem = {
  /** Interpretations/normalizations and configuration errors – reported, never silent. */
  warnings?: string[];
  entityType: string;
  sourceKey: string;
  sourceHash: string;
  action: ImportAction;
  targetId?: string;
  reason?: string;
};

export type ImportResult = {
  runId: string;
  mode: "dry-run" | "apply";
  items: ImportItem[];
  summary: Record<string, Partial<Record<ImportAction, number>>>;
};

export type ImportOptions = {
  mode: "dry-run" | "apply";
  snapshotSha256: string;
  actorAdminId: string | null;
  now: Date;
  /** Operational data (requests): days after departure. Default 180. */
  retentionDays?: number;
  /**
   * Records with evidential value (orders/bookings, extensions with amounts): days after the
   * order / new departure. Default 3650 (10 years) until the retention decision is made; the
   * legally relevant documents themselves (invoices, folios) stay in Apaleo.
   */
  recordRetentionDays?: number;
};

const sha = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const obj = (value: unknown): Obj =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {};
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const cents = (value: unknown): number | null => {
  const n = num(value);
  return n === null ? null : Math.round(n * 100);
};
const SERVICE_ID = /^[A-Za-z0-9_-]{1,120}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (value: unknown): string | null => {
  const s = str(value).slice(0, 10);
  return DAY.test(s) ? s : null;
};
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);
const shortHash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);

class DryRunRollback extends Error {}

/* ------------------------------------------------------------------------------------------
 * Catalog normalization
 * ---------------------------------------------------------------------------------------- */

export type CatalogMember = { apaleoPropertyId: string; item: Obj };

/** Catalog items per Apaleo property; legacy array catalogs only where no hash exists. */
export function catalogMembers(snapshot: ExtrasSnapshotLike): CatalogMember[] {
  const members: CatalogMember[] = [];
  const hashed = new Set<string>();
  for (const entry of snapshot.entries) {
    const match = /^catalog:([^:]+):items$/.exec(entry.key);
    if (!match?.[1]) continue;
    hashed.add(match[1]);
    for (const item of Object.values(obj(entry.value)))
      members.push({ apaleoPropertyId: match[1], item: obj(item) });
  }
  for (const entry of snapshot.entries) {
    const match = /^catalog:([^:]+)$/.exec(entry.key);
    if (!match?.[1] || hashed.has(match[1]) || !Array.isArray(entry.value)) continue;
    for (const item of entry.value) members.push({ apaleoPropertyId: match[1], item: obj(item) });
  }
  return members.filter((m) => SERVICE_ID.test(str(m.item.serviceId)));
}

export function groupKeyOf(item: Obj): string {
  const code = str(item.code);
  return /^[A-Za-z0-9_-]{1,120}$/.test(code) ? code : str(item.serviceId);
}

/**
 * The property configuration an Extras item maps to (fields of offer_properties), plus every
 * interpretation that was necessary. Values are taken over as stored; only what the STAY
 * model cannot represent is normalized, and each such case becomes a warning in the report.
 */
export function configWithWarnings(item: Obj) {
  const warnings: string[] = [];
  const flag = (key: string) => {
    const result = normalizeBoolean(item[key]);
    if (result.normalized && item[key] !== undefined) warnings.push(`boolean_normalized:${key}`);
    return result.value;
  };
  const actionType = item.actionType === "increase_occupancy" ? "increase_occupancy" : "service";
  if (item.actionType !== undefined && item.actionType !== actionType)
    warnings.push("unknown_action_type");
  const isOccupancy = actionType === "increase_occupancy";
  const knownRule = ["per_stay", "per_night", "arrival_day", "departure_day"].includes(
    str(item.bookingRule),
  );
  const bookingRule = knownRule
    ? (str(item.bookingRule) as "per_stay" | "per_night" | "arrival_day" | "departure_day")
    : "per_stay";
  if (!knownRule && item.bookingRule !== undefined && item.bookingRule !== "")
    warnings.push("unknown_booking_rule");
  const storedFulfillment = item.fulfillmentMode === "request" ? "request" : "instant";
  const fulfillment: "instant" | "request" = isOccupancy ? "instant" : storedFulfillment;
  if (isOccupancy && storedFulfillment !== "instant")
    warnings.push("occupancy_fulfillment_forced_instant");
  let extraPersonPriceCents: number | null = null;
  if (isOccupancy) {
    const parsed = parsePriceToCents(item.extraPersonPricePerNight);
    if (parsed === null) warnings.push("config_error:missing_extra_person_price");
    else if (Number.isNaN(parsed) || parsed < 0 || parsed > 10_000_000)
      warnings.push("config_error:invalid_extra_person_price");
    else extraPersonPriceCents = parsed;
  }
  const requiresCapacity = flag("requiresRemainingCapacity");
  if (isOccupancy && !requiresCapacity) warnings.push("occupancy_capacity_rule_forced");
  const labelDe = str(item.priceUnitLabelDe) || str(item.priceUnitLabel);
  const labelEn = str(item.priceUnitLabelEn);
  const rawGroups = Array.isArray(item.allowedUnitGroupIds)
    ? item.allowedUnitGroupIds.map(str).filter(Boolean)
    : [];
  const unitGroups = rawGroups.filter((id) => /^[A-Za-z0-9_-]{1,80}$/.test(id)).slice(0, 50);
  if (unitGroups.length !== rawGroups.length) warnings.push("invalid_unit_group_ids_dropped");
  const sortOrder = num(item.sortOrder);
  const config = {
    extrasServiceId: str(item.serviceId),
    active: flag("active"),
    actionType,
    bookingRule,
    fulfillment,
    extraPersonPriceCents,
    currency: extraPersonPriceCents !== null ? "EUR" : null,
    priceUnitLabel:
      labelDe || labelEn
        ? { ...(labelDe ? { de: labelDe } : {}), ...(labelEn ? { en: labelEn } : {}) }
        : null,
    requiresRemainingCapacity: isOccupancy || requiresCapacity,
    requiresVehicleRegistration: flag("requiresVehicleRegistration"),
    maxOnePerReservation: flag("maxOnePerReservation"),
    allowedUnitGroupIds: unitGroups,
    sortOrder: sortOrder ?? 1000,
  } as const;
  for (const issue of serviceConfigIssues(config)) {
    if (!warnings.includes(`config_error:${issue}`)) warnings.push(`config_error:${issue}`);
  }
  return { config, warnings };
}

export function configOf(item: Obj) {
  return configWithWarnings(item).config;
}

function textsOf(item: Obj) {
  const titleDe =
    str(item.displayNameDe) || str(item.displayName) || str(item.name) || str(item.serviceId);
  const titleEn = str(item.displayNameEn);
  const teaserDe = str(item.descriptionDe) || str(item.description);
  const teaserEn = str(item.descriptionEn);
  return {
    title: { de: titleDe, ...(titleEn ? { en: titleEn } : {}) },
    teaser: teaserDe ? { de: teaserDe, ...(teaserEn ? { en: teaserEn } : {}) } : null,
  };
}

function categoryOf(item: Obj): OfferCategory {
  if (item.actionType === "increase_occupancy") return "comfort";
  if (item.maxOnePerReservation === true) return "pets";
  if (item.requiresVehicleRegistration === true) return "mobility";
  if (item.bookingRule === "arrival_day" || item.bookingRule === "departure_day")
    return "arrival-departure";
  return "comfort";
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return slug || "service";
}

/* ------------------------------------------------------------------------------------------
 * Import
 * ---------------------------------------------------------------------------------------- */

export async function importExtrasSnapshot(
  db: Database,
  context: TenantContext,
  snapshot: ExtrasSnapshotLike,
  options: ImportOptions,
): Promise<ImportResult> {
  const items: ImportItem[] = [];
  const add = (item: ImportItem) => items.push(item);
  const retentionDays = options.retentionDays ?? 180;
  const recordRetentionDays = options.recordRetentionDays ?? 3650;
  let failure: unknown;

  try {
    await db.transaction(async (tx) => {
      const propertyMap = new Map<string, string | null>();
      const mapProperty = async (apaleoId: string): Promise<string | null> => {
        if (!propertyMap.has(apaleoId)) {
          propertyMap.set(
            apaleoId,
            (await resolveExternalMapping(tx, context, {
              provider: "apaleo",
              entityType: "property",
              externalId: apaleoId,
            })) ?? null,
          );
        }
        return propertyMap.get(apaleoId) ?? null;
      };

      await importCatalog(tx, context, snapshot, mapProperty, add, options.now);
      await importSettings(tx, context, snapshot, mapProperty, add, options.now);
      await importHistory(tx, context, snapshot, mapProperty, add, options.now, {
        operational: retentionDays,
        records: recordRetentionDays,
      });
      importUsersAndImages(snapshot, add);

      if (options.mode === "apply") {
        await recordAdminAuditEvent(tx, context, {
          actorType: "import",
          actorAdminId: options.actorAdminId,
          action: "migration.applied",
          entityType: "migration_run",
          details: { snapshot: options.snapshotSha256.slice(0, 16), summary: summarize(items) },
        });
      } else {
        throw new DryRunRollback();
      }
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) failure = error;
  }

  const summary = summarize(items);
  const [run] = await db
    .insert(migrationRuns)
    .values({
      tenantId: context.tenantId,
      mode: options.mode,
      status: failure ? "failed" : "completed",
      snapshotSha256: options.snapshotSha256,
      startedBy: options.actorAdminId,
      summary: failure
        ? { ...summary, error: failure instanceof Error ? failure.name : "unknown" }
        : summary,
      startedAt: options.now,
      finishedAt: new Date(),
    })
    .returning({ id: migrationRuns.id });
  if (!run) throw new Error("migration run not recorded");
  // Per-record results (keys and stable reasons only).
  const unique = new Map(items.map((item) => [`${item.entityType}\u0000${item.sourceKey}`, item]));
  const rows = [...unique.values()].map((item) => ({
    tenantId: context.tenantId,
    runId: run.id,
    entityType: item.entityType,
    sourceKey: item.sourceKey.slice(0, 200),
    sourceHash: item.sourceHash,
    action: item.action,
    targetId: item.targetId ?? null,
    reason: item.reason ?? (item.warnings?.[0] ? warningCode(item.warnings[0]) : null),
  }));
  for (let i = 0; i < rows.length; i += 200)
    await db.insert(migrationItems).values(rows.slice(i, i + 200));
  if (failure) throw failure instanceof Error ? failure : new Error("Extras import failed");
  return { runId: run.id, mode: options.mode, items, summary };
}

/** A stable reason code for migration_items (pattern ^[a-z0-9_]{1,60}$). */
function warningCode(warning: string): string {
  return `w_${warning.toLowerCase().replace(/[^a-z0-9_]+/g, "_")}`.slice(0, 60);
}

function summarize(items: readonly ImportItem[]): ImportResult["summary"] {
  const summary: ImportResult["summary"] = {};
  for (const item of items) {
    const bucket = (summary[item.entityType] ??= {});
    bucket[item.action] = (bucket[item.action] ?? 0) + 1;
  }
  return summary;
}

type MapProperty = (apaleoId: string) => Promise<string | null>;
type Add = (item: ImportItem) => void;

async function importCatalog(
  tx: Tx,
  context: TenantContext,
  snapshot: ExtrasSnapshotLike,
  mapProperty: MapProperty,
  add: Add,
  now: Date,
) {
  const groups = new Map<string, CatalogMember[]>();
  for (const member of catalogMembers(snapshot)) {
    const key = groupKeyOf(member.item);
    groups.set(key, [...(groups.get(key) ?? []), member]);
  }

  for (const [groupKey, members] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const mapped: { member: CatalogMember; propertyId: string }[] = [];
    for (const member of members) {
      const propertyId = await mapProperty(member.apaleoPropertyId);
      const sourceKey = `${member.apaleoPropertyId}:${str(member.item.serviceId)}`;
      if (!propertyId)
        add({
          entityType: "catalog_item",
          sourceKey,
          sourceHash: sha(member.item),
          action: "skip",
          reason: "property_not_mapped",
        });
      else mapped.push({ member, propertyId });
    }
    if (!mapped.length) continue;

    const legacyKey = `extras:${groupKey}`;
    let [offer] = await tx
      .select({
        id: offers.id,
        title: offers.title,
        teaser: offers.teaser,
        legacyKey: offers.legacyKey,
        kind: offers.kind,
      })
      .from(offers)
      .where(and(eq(offers.tenantId, context.tenantId), eq(offers.legacyKey, legacyKey)));
    if (!offer) {
      const serviceIds = mapped.map((m) => str(m.member.item.serviceId));
      const [linked] = await tx
        .select({ offerId: offerProperties.offerId })
        .from(offerProperties)
        .where(
          and(
            eq(offerProperties.tenantId, context.tenantId),
            inArray(offerProperties.extrasServiceId, serviceIds),
          ),
        );
      if (linked) {
        [offer] = await tx
          .select({
            id: offers.id,
            title: offers.title,
            teaser: offers.teaser,
            legacyKey: offers.legacyKey,
            kind: offers.kind,
          })
          .from(offers)
          .where(and(eq(offers.tenantId, context.tenantId), eq(offers.id, linked.offerId)));
        if (offer && !offer.legacyKey) {
          await tx
            .update(offers)
            .set({ legacyKey })
            .where(and(eq(offers.tenantId, context.tenantId), eq(offers.id, offer.id)));
        }
        add({
          entityType: "catalog_offer",
          sourceKey: legacyKey,
          sourceHash: sha(serviceIds),
          action: "update",
          targetId: offer?.id,
          reason: "linked_existing_offer",
        });
      }
    } else {
      add({
        entityType: "catalog_offer",
        sourceKey: legacyKey,
        sourceHash: sha(mapped.map((m) => str(m.member.item.serviceId))),
        action: "unchanged",
        targetId: offer.id,
      });
    }
    if (offer && offer.kind !== "house-service") {
      for (const { member } of mapped) {
        add({
          entityType: "catalog_item",
          sourceKey: `${member.apaleoPropertyId}:${str(member.item.serviceId)}`,
          sourceHash: sha(member.item),
          action: "conflict",
          reason: "offer_is_partner_offer",
        });
      }
      continue;
    }
    if (!offer) {
      const lead =
        (mapped.find((m) => m.member.item.active === true) ?? mapped[0])?.member.item ?? {};
      const texts = textsOf(lead);
      const allRequest = mapped.every((m) => configOf(m.member.item).fulfillment === "request");
      const [created] = await tx
        .insert(offers)
        .values({
          tenantId: context.tenantId,
          kind: "house-service",
          category: categoryOf(lead),
          status: "draft",
          slug: { de: slugify(texts.title.de) },
          title: texts.title,
          teaser: texts.teaser ?? { de: texts.title.de },
          fulfillment: allRequest ? "request" : "instant",
          cancellation: { type: "on-request" },
          availability: DEFAULT_AVAILABILITY,
          sortOrder: configOf(lead).sortOrder,
          legacyKey,
          createdAt: now,
          updatedAt: now,
        })
        .returning({
          id: offers.id,
          title: offers.title,
          teaser: offers.teaser,
          legacyKey: offers.legacyKey,
          kind: offers.kind,
        });
      offer = created;
      add({
        entityType: "catalog_offer",
        sourceKey: legacyKey,
        sourceHash: sha(lead),
        action: "create",
        targetId: created?.id,
        reason: "draft",
      });
    }
    if (!offer) continue;

    for (const { member, propertyId } of mapped) {
      await upsertPropertyConfig(tx, context, offer, member, propertyId, add, now);
    }
  }
}

async function upsertPropertyConfig(
  tx: Tx,
  context: TenantContext,
  offer: { id: string; title: Obj; teaser: Obj },
  member: CatalogMember,
  propertyId: string,
  add: Add,
  now: Date,
) {
  const serviceId = str(member.item.serviceId);
  const sourceKey = `${member.apaleoPropertyId}:${serviceId}`;
  const { updatedAt: _ignored, ...relevant } = member.item;
  const hash = sha(relevant);
  const { config, warnings } = configWithWarnings(member.item);
  const report: Add = (item) => {
    add(warnings.length ? { ...item, warnings } : item);
  };
  const texts = textsOf(member.item);
  const titleOverride =
    texts.title.de !== str(offer.title.de) ||
    (texts.title.en && texts.title.en !== str(offer.title.en))
      ? texts.title
      : null;
  const teaserOverride =
    texts.teaser && texts.teaser.de !== str(offer.teaser.de) ? texts.teaser : null;

  const [byService] = await tx
    .select({ offerId: offerProperties.offerId })
    .from(offerProperties)
    .where(
      and(
        eq(offerProperties.tenantId, context.tenantId),
        eq(offerProperties.propertyId, propertyId),
        eq(offerProperties.extrasServiceId, serviceId),
      ),
    );
  if (byService && byService.offerId !== offer.id) {
    report({
      entityType: "catalog_item",
      sourceKey,
      sourceHash: hash,
      action: "conflict",
      targetId: byService.offerId,
      reason: "service_linked_to_other_offer",
    });
    return;
  }
  const [existing] = await tx
    .select()
    .from(offerProperties)
    .where(
      and(
        eq(offerProperties.tenantId, context.tenantId),
        eq(offerProperties.offerId, offer.id),
        eq(offerProperties.propertyId, propertyId),
      ),
    );
  const bookkeeping = { legacyKey: sourceKey, importedHash: hash, importedAt: now, updatedAt: now };

  if (!existing) {
    await tx.insert(offerProperties).values({
      tenantId: context.tenantId,
      offerId: offer.id,
      propertyId,
      ...config,
      titleOverride,
      teaserOverride,
      ...bookkeeping,
      createdAt: now,
    });
    report({
      entityType: "catalog_item",
      sourceKey,
      sourceHash: hash,
      action: "create",
      targetId: `${offer.id}:${propertyId}`,
    });
    return;
  }
  if (existing.extrasServiceId && existing.extrasServiceId !== serviceId) {
    report({
      entityType: "catalog_item",
      sourceKey,
      sourceHash: hash,
      action: "conflict",
      targetId: `${offer.id}:${propertyId}`,
      reason: "different_service_at_property",
    });
    return;
  }
  if (existing.importedHash === hash) {
    report({
      entityType: "catalog_item",
      sourceKey,
      sourceHash: hash,
      action: "unchanged",
      targetId: `${offer.id}:${propertyId}`,
    });
    return;
  }
  const editedInStay =
    existing.importedAt !== null &&
    existing.updatedAt.getTime() > existing.importedAt.getTime() + 1000;
  if (editedInStay) {
    report({
      entityType: "catalog_item",
      sourceKey,
      sourceHash: hash,
      action: "conflict",
      targetId: `${offer.id}:${propertyId}`,
      reason: "changed_in_stay_since_import",
    });
    return;
  }
  // STAY-owned rows (never imported): configuration only – STAY texts and media stay.
  const stayOwned = existing.importedHash === null;
  await tx
    .update(offerProperties)
    .set({ ...config, ...(stayOwned ? {} : { titleOverride, teaserOverride }), ...bookkeeping })
    .where(
      and(
        eq(offerProperties.tenantId, context.tenantId),
        eq(offerProperties.offerId, offer.id),
        eq(offerProperties.propertyId, propertyId),
      ),
    );
  report({
    entityType: "catalog_item",
    sourceKey,
    sourceHash: hash,
    action: "update",
    targetId: `${offer.id}:${propertyId}`,
    ...(stayOwned ? { reason: "linked_stay_configuration" } : {}),
  });
}

async function importSettings(
  tx: Tx,
  context: TenantContext,
  snapshot: ExtrasSnapshotLike,
  mapProperty: MapProperty,
  add: Add,
  now: Date,
) {
  for (const entry of snapshot.entries) {
    const match = /^extension-night:config:([^:]+)$/.exec(entry.key);
    if (!match?.[1]) continue;
    const apaleoId = match[1];
    const { updatedAt: _ignored, ...stored } = obj(entry.value);
    const hash = sha(stored);
    const propertyId = await mapProperty(apaleoId);
    if (!propertyId) {
      add({
        entityType: "property_settings",
        sourceKey: apaleoId,
        sourceHash: hash,
        action: "skip",
        reason: "property_not_mapped",
      });
      continue;
    }
    const { settings: s, notes } = resolveStayExtensionSettingsDetailed(stored);
    const report: Add = (item) => {
      add(notes.length ? { ...item, warnings: notes } : item);
    };
    const clamp = (n: number) => Math.min(90, Math.max(0, Math.round(n)));
    const values = {
      extensionNightEnabled: s.extensionNightEnabled,
      discountPreArrivalOneNightGap: clamp(s.extensionDiscountPreArrivalOneNightGap),
      discountPreArrivalStandard: clamp(s.extensionDiscountPreArrivalStandard),
      discountInHouseOneNightGap: clamp(s.extensionDiscountInHouseOneNightGap),
      discountInHouseStandard: clamp(s.extensionDiscountInHouseStandard),
      minSellableStayNights: Math.min(30, Math.max(1, Math.round(s.minSellableStayNights))),
      importedHash: hash,
      importedAt: now,
      updatedAt: now,
    };
    const [existing] = await tx
      .select()
      .from(propertyServiceSettings)
      .where(
        and(
          eq(propertyServiceSettings.tenantId, context.tenantId),
          eq(propertyServiceSettings.propertyId, propertyId),
        ),
      );
    if (!existing) {
      await tx
        .insert(propertyServiceSettings)
        .values({ tenantId: context.tenantId, propertyId, ...values, createdAt: now });
      report({
        entityType: "property_settings",
        sourceKey: apaleoId,
        sourceHash: hash,
        action: "create",
        targetId: propertyId,
      });
    } else if (existing.importedHash === hash) {
      report({
        entityType: "property_settings",
        sourceKey: apaleoId,
        sourceHash: hash,
        action: "unchanged",
        targetId: propertyId,
      });
    } else if (
      existing.importedAt === null ||
      existing.updatedAt.getTime() > existing.importedAt.getTime() + 1000
    ) {
      report({
        entityType: "property_settings",
        sourceKey: apaleoId,
        sourceHash: hash,
        action: "conflict",
        targetId: propertyId,
        reason:
          existing.importedAt === null ? "configured_in_stay" : "changed_in_stay_since_import",
      });
    } else {
      await tx
        .update(propertyServiceSettings)
        .set(values)
        .where(
          and(
            eq(propertyServiceSettings.tenantId, context.tenantId),
            eq(propertyServiceSettings.propertyId, propertyId),
          ),
        );
      report({
        entityType: "property_settings",
        sourceKey: apaleoId,
        sourceHash: hash,
        action: "update",
        targetId: propertyId,
      });
    }
  }
}

async function offerFor(
  tx: Tx,
  context: TenantContext,
  propertyId: string,
  serviceId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ offerId: offerProperties.offerId })
    .from(offerProperties)
    .where(
      and(
        eq(offerProperties.tenantId, context.tenantId),
        eq(offerProperties.propertyId, propertyId),
        eq(offerProperties.extrasServiceId, serviceId),
      ),
    );
  return row?.offerId ?? null;
}

async function importHistory(
  tx: Tx,
  context: TenantContext,
  snapshot: ExtrasSnapshotLike,
  mapProperty: MapProperty,
  add: Add,
  now: Date,
  retention: { operational: number; records: number },
) {
  const valueOf = (key: string) => snapshot.entries.find((e) => e.key === key)?.value;

  // Orders → service_bookings (+ items)
  const orders = Array.isArray(valueOf("orders")) ? (valueOf("orders") as unknown[]).map(obj) : [];
  for (const order of orders) {
    const legacyId = str(order.id);
    const hash = sha(order);
    if (!legacyId || legacyId.length > 100) {
      add({
        entityType: "order",
        sourceKey: `order:${shortHash(hash)}`,
        sourceHash: hash,
        action: "skip",
        reason: "missing_id",
      });
      continue;
    }
    const sourceKey = `order:${legacyId}`;
    const propertyId = await mapProperty(str(order.propertyId));
    const reservationId = str(order.reservationId);
    if (!propertyId || !reservationId) {
      add({
        entityType: "order",
        sourceKey,
        sourceHash: hash,
        action: "skip",
        reason: propertyId ? "missing_reservation" : "property_not_mapped",
      });
      continue;
    }
    const createdAt = new Date(str(order.createdAt) || now.toISOString());
    const lines = Array.isArray(order.items) ? order.items.map(obj) : [];
    const total = lines.reduce((sum, line) => sum + (cents(obj(line.price).amount) ?? 0), 0);
    const [booking] = await tx
      .insert(serviceBookings)
      .values({
        tenantId: context.tenantId,
        propertyId,
        reservationProvider: "apaleo",
        externalReservationId: reservationId.slice(0, 100),
        externalBookingId: str(order.bookingId).slice(0, 100) || null,
        status: "completed",
        totalCents: total,
        currency: "EUR",
        source: "extras",
        legacyId,
        purgeAfter: addDays(createdAt, retention.records),
        createdAt,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [serviceBookings.tenantId, serviceBookings.legacyId] })
      .returning({ id: serviceBookings.id });
    if (!booking) {
      add({ entityType: "order", sourceKey, sourceHash: hash, action: "unchanged" });
      continue;
    }
    for (const line of lines) {
      const serviceId = str(line.serviceId);
      if (!SERVICE_ID.test(serviceId)) continue;
      await tx.insert(serviceBookingItems).values({
        tenantId: context.tenantId,
        bookingId: booking.id,
        offerId: await offerFor(tx, context, propertyId, serviceId),
        apaleoServiceId: serviceId,
        displayName: (str(line.displayName) || serviceId).slice(0, 200),
        quantity: Math.min(50, Math.max(1, Math.round(num(line.count) ?? 1))),
        amountCents: cents(obj(line.price).amount),
        currency: str(obj(line.price).currency) || "EUR",
        status: "booked",
        createdAt,
        updatedAt: now,
      });
    }
    add({
      entityType: "order",
      sourceKey,
      sourceHash: hash,
      action: "create",
      targetId: booking.id,
    });
  }

  // Requests → offer_requests
  const requests = Object.values(obj(valueOf("requests:items"))).map(obj);
  const statusMap: Record<string, "pending" | "confirmed" | "declined"> = {
    pending: "pending",
    approved: "confirmed",
    rejected: "declined",
  };
  for (const request of requests) {
    const legacyId = str(request.requestId);
    const hash = sha(request);
    const sourceKey = `request:${legacyId || shortHash(hash)}`;
    const status = statusMap[str(request.status)];
    const propertyId = await mapProperty(str(request.propertyId));
    const serviceId = str(request.serviceId);
    if (!legacyId || legacyId.length > 100 || !status) {
      add({
        entityType: "request",
        sourceKey,
        sourceHash: hash,
        action: "skip",
        reason: "invalid_record",
      });
      continue;
    }
    if (!str(request.reservationId)) {
      add({
        entityType: "request",
        sourceKey,
        sourceHash: hash,
        action: "skip",
        reason: "missing_reservation",
      });
      continue;
    }
    if (!propertyId) {
      add({
        entityType: "request",
        sourceKey,
        sourceHash: hash,
        action: "skip",
        reason: "property_not_mapped",
      });
      continue;
    }
    const offerId = SERVICE_ID.test(serviceId)
      ? await offerFor(tx, context, propertyId, serviceId)
      : null;
    if (!offerId) {
      add({
        entityType: "request",
        sourceKey,
        sourceHash: hash,
        action: "skip",
        reason: "offer_not_found",
      });
      continue;
    }
    const dates = (value: unknown) =>
      Array.isArray(value)
        ? value
            .map(day)
            .filter((d): d is string => d !== null)
            .slice(0, 400)
        : null;
    const departure = day(request.departureDate);
    const createdAt = new Date(str(request.createdAt) || now.toISOString());
    const [row] = await tx
      .insert(offerRequests)
      .values({
        tenantId: context.tenantId,
        offerId,
        propertyId,
        reservationProvider: "apaleo",
        externalReservationId: str(request.reservationId).slice(0, 100),
        status,
        requestedDate: day(request.requestedServiceDate),
        quotedCents: cents(request.displayedPrice),
        currency: str(request.currency) || "EUR",
        slackNotifiedAt: str(request.slackNotifiedAt)
          ? new Date(str(request.slackNotifiedAt))
          : null,
        purgeAfter: addDays(
          departure ? new Date(`${departure}T00:00:00Z`) : createdAt,
          retention.operational,
        ),
        apaleoServiceId: serviceId,
        quantity: Math.min(50, Math.max(1, Math.round(num(request.requestedQuantity) ?? 1))),
        requestedDates: dates(request.requestedServiceDates),
        bookedServiceDates: dates(request.bookedServiceDates),
        source: "extras",
        legacyId,
        createdAt,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [offerRequests.tenantId, offerRequests.legacyId] })
      .returning({ id: offerRequests.id });
    add({
      entityType: "request",
      sourceKey,
      sourceHash: hash,
      action: row ? "create" : "unchanged",
      ...(row ? { targetId: row.id } : {}),
    });
  }

  // Stay extensions → stay_extensions
  const extensions = Object.values(obj(valueOf("stay-extensions:records"))).map(obj);
  for (const record of extensions) {
    const legacyId = str(record.id);
    const hash = sha(record);
    const sourceKey = `extension:${legacyId || shortHash(hash)}`;
    const oldDeparture = day(record.oldDeparture);
    const newDeparture = day(record.newDeparture);
    if (
      !legacyId ||
      legacyId.length > 100 ||
      !oldDeparture ||
      !newDeparture ||
      newDeparture <= oldDeparture
    ) {
      add({
        entityType: "extension",
        sourceKey,
        sourceHash: hash,
        action: "skip",
        reason: "invalid_record",
      });
      continue;
    }
    if (!str(record.propertyId)) {
      add({
        entityType: "extension",
        sourceKey,
        sourceHash: hash,
        action: "skip",
        reason: "property_missing",
      });
      continue;
    }
    const propertyId = await mapProperty(str(record.propertyId));
    if (!propertyId) {
      add({
        entityType: "extension",
        sourceKey,
        sourceHash: hash,
        action: "skip",
        reason: "property_not_mapped",
      });
      continue;
    }
    const status = ["confirmed", "confirmed_with_issues", "failed"].includes(str(record.status))
      ? (str(record.status) as "confirmed")
      : "failed";
    const money = (value: unknown) => cents(obj(value).amount);
    const details = {
      extras: (Array.isArray(record.extras) ? record.extras : []).map(obj).map((e) => ({
        serviceId: str(e.serviceId),
        extended: e.extended === true,
        amountCents: money(e.amount),
      })),
      lateCheckoutMoves: (Array.isArray(record.lateCheckoutMoves) ? record.lateCheckoutMoves : [])
        .map(obj)
        .map((m) => ({
          serviceId: str(m.serviceId),
          moved: m.moved === true,
          verified: m.verified === true,
        })),
      cityTax: {
        applicable: obj(record.cityTax).applicable === true,
        verified: obj(record.cityTax).verified === true,
        amountCents: money(obj(record.cityTax).amount),
      },
    };
    const createdAt = new Date(str(record.createdAt) || now.toISOString());
    const [row] = await tx
      .insert(stayExtensions)
      .values({
        tenantId: context.tenantId,
        propertyId,
        reservationProvider: "apaleo",
        externalReservationId: str(record.reservationId).slice(0, 100),
        oldDeparture,
        newDeparture,
        newDepartureConfirmed: record.newDepartureConfirmed === true,
        phase: record.phase === "in_house" || record.phase === "pre_arrival" ? record.phase : null,
        gap: num(record.gap),
        averageNightlyRateCents: cents(record.originalAverageNightlyRate),
        discountPercent: num(record.discountPercent),
        extensionPriceCents: money(record.extensionPrice),
        totalAdditionalCents: money(record.totalAdditionalAmount),
        currency: str(obj(record.extensionPrice).currency) || "EUR",
        details,
        mandatoryServicesIntact:
          typeof record.mandatoryServicesIntact === "boolean"
            ? record.mandatoryServicesIntact
            : null,
        status,
        source: "extras",
        legacyId,
        purgeAfter: addDays(new Date(`${newDeparture}T00:00:00Z`), retention.records),
        createdAt,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [stayExtensions.tenantId, stayExtensions.legacyId] })
      .returning({ id: stayExtensions.id });
    add({
      entityType: "extension",
      sourceKey,
      sourceHash: hash,
      action: row ? "create" : "unchanged",
      ...(row ? { targetId: row.id } : {}),
    });
  }
}

function importUsersAndImages(snapshot: ExtrasSnapshotLike, add: Add) {
  const users = snapshot.entries.find((e) => e.key === "users")?.value;
  for (const user of Array.isArray(users) ? users.map(obj) : []) {
    // Never the user name – only a pseudonymous key and the role for the invitation list.
    add({
      entityType: "user",
      sourceKey: `user:${shortHash(str(user.id))}`,
      sourceHash: sha({ role: user.role }),
      action: "skip",
      reason: `invite_as_${["admin", "manager", "viewer"].includes(str(user.role)) ? str(user.role) : "viewer"}`,
    });
  }
  for (const entry of snapshot.entries) {
    if (!entry.key.startsWith("image:")) continue;
    add({
      entityType: "image",
      sourceKey: entry.key,
      sourceHash: sha(entry.value),
      action: "skip",
      reason: "media_import_pending",
    });
  }
}
