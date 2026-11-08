/**
 * Reconciliation (M1-D): compares an Extras snapshot with the STAY data after an import –
 * per property service configuration and per history record. Output contains ids, field
 * names and counts only.
 */
import { type TenantContext } from "@up/core";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { type Database } from "../client";
import { offerProperties, offerRequests, serviceBookings, stayExtensions } from "../schema";
import { resolveExternalMapping } from "../repositories/tenancy-repository";
import { catalogMembers, configOf, type ExtrasSnapshotLike, type ImportResult } from "./importer";

export type CatalogComparison = {
  apaleoPropertyId: string;
  serviceId: string;
  status: "match" | "different" | "missing" | "unmapped" | "stay-only";
  fields: string[];
};

export type Reconciliation = {
  catalog: CatalogComparison[];
  history: { entity: string; source: number; imported: number }[];
};

const COMPARED_FIELDS = [
  "active",
  "actionType",
  "bookingRule",
  "fulfillment",
  "extraPersonPriceCents",
  "requiresRemainingCapacity",
  "requiresVehicleRegistration",
  "maxOnePerReservation",
  "allowedUnitGroupIds",
] as const;

export async function reconcileExtras(
  db: Database,
  context: TenantContext,
  snapshot: ExtrasSnapshotLike,
): Promise<Reconciliation> {
  const catalog: CatalogComparison[] = [];
  const seen = new Set<string>();
  const mapped = new Map<string, string>();
  for (const member of catalogMembers(snapshot)) {
    const serviceId = String(member.item.serviceId);
    let propertyId = mapped.get(member.apaleoPropertyId);
    if (propertyId === undefined) {
      propertyId =
        (await resolveExternalMapping(db, context, {
          provider: "apaleo",
          entityType: "property",
          externalId: member.apaleoPropertyId,
        })) ?? "";
      mapped.set(member.apaleoPropertyId, propertyId);
    }
    if (!propertyId) {
      catalog.push({
        apaleoPropertyId: member.apaleoPropertyId,
        serviceId,
        status: "unmapped",
        fields: [],
      });
      continue;
    }
    seen.add(`${propertyId}:${serviceId}`);
    const [row] = await db
      .select()
      .from(offerProperties)
      .where(
        and(
          eq(offerProperties.tenantId, context.tenantId),
          eq(offerProperties.propertyId, propertyId),
          eq(offerProperties.extrasServiceId, serviceId),
        ),
      );
    if (!row) {
      catalog.push({
        apaleoPropertyId: member.apaleoPropertyId,
        serviceId,
        status: "missing",
        fields: [],
      });
      continue;
    }
    const expected = configOf(member.item);
    const fields = COMPARED_FIELDS.filter(
      (field) => JSON.stringify(expected[field]) !== JSON.stringify(row[field]),
    );
    catalog.push({
      apaleoPropertyId: member.apaleoPropertyId,
      serviceId,
      status: fields.length ? "different" : "match",
      fields,
    });
  }
  const propertyIds = [...new Set([...mapped.values()].filter(Boolean))];
  if (propertyIds.length) {
    const stayRows = await db
      .select({
        propertyId: offerProperties.propertyId,
        serviceId: offerProperties.extrasServiceId,
      })
      .from(offerProperties)
      .where(
        and(
          eq(offerProperties.tenantId, context.tenantId),
          inArray(offerProperties.propertyId, propertyIds),
          isNotNull(offerProperties.extrasServiceId),
        ),
      );
    for (const row of stayRows) {
      if (row.serviceId && !seen.has(`${row.propertyId}:${row.serviceId}`)) {
        catalog.push({
          apaleoPropertyId: `(STAY ${row.propertyId})`,
          serviceId: row.serviceId,
          status: "stay-only",
          fields: [],
        });
      }
    }
  }

  const value = (key: string) => snapshot.entries.find((e) => e.key === key)?.value;
  const sourceOrders = Array.isArray(value("orders")) ? (value("orders") as unknown[]).length : 0;
  const sourceRequests = Object.keys((value("requests:items") as object | undefined) ?? {}).length;
  const sourceExtensions = Object.keys(
    (value("stay-extensions:records") as object | undefined) ?? {},
  ).length;
  const imported = async (
    table: typeof serviceBookings | typeof offerRequests | typeof stayExtensions,
  ) =>
    (
      await db
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.tenantId, context.tenantId), eq(table.source, "extras")))
    ).length;
  return {
    catalog,
    history: [
      { entity: "Bestellungen", source: sourceOrders, imported: await imported(serviceBookings) },
      { entity: "Anfragen", source: sourceRequests, imported: await imported(offerRequests) },
      {
        entity: "Verlängerungen",
        source: sourceExtensions,
        imported: await imported(stayExtensions),
      },
    ],
  };
}

const ACTION_LABELS: Record<string, string> = {
  create: "neu",
  update: "aktualisiert",
  unchanged: "unverändert",
  conflict: "Konflikt",
  skip: "übersprungen",
  error: "Fehler",
};

export function renderImportReport(result: ImportResult, reconciliation: Reconciliation): string {
  const reasons = new Map<string, number>();
  for (const item of result.items) {
    if (item.reason && (item.action === "skip" || item.action === "conflict")) {
      const key = `${item.entityType}: ${item.reason}`;
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
  }
  const count = (status: CatalogComparison["status"]) =>
    reconciliation.catalog.filter((c) => c.status === status).length;
  return [
    `# Extras-Import (${result.mode === "apply" ? "Übernahme" : "Probelauf"})`,
    "",
    `Lauf: \`${result.runId}\``,
    "",
    "## Ergebnis je Bereich",
    "",
    "| Bereich | " + Object.values(ACTION_LABELS).join(" | ") + " |",
    "|---|" +
      Object.keys(ACTION_LABELS)
        .map(() => "---")
        .join("|") +
      "|",
    ...Object.entries(result.summary)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([entity, actions]) =>
          `| ${entity} | ${Object.keys(ACTION_LABELS)
            .map((a) => actions[a as keyof typeof actions] ?? 0)
            .join(" | ")} |`,
      ),
    "",
    "## Gründe (übersprungen / Konflikte)",
    "",
    ...[...reasons.entries()].sort().map(([key, n]) => `- ${key}: ${n}`),
    ...(reasons.size ? [] : ["- keine"]),
    "",
    "## Abgleich Service-Konfiguration",
    "",
    `- übereinstimmend: ${count("match")}, abweichend: ${count("different")}, fehlend in STAY: ${count("missing")}, ohne Objektzuordnung: ${count("unmapped")}, nur in STAY: ${count("stay-only")}`,
    ...reconciliation.catalog
      .filter((c) => c.status !== "match")
      .map(
        (c) =>
          `- ${c.apaleoPropertyId}/${c.serviceId}: ${c.status}${c.fields.length ? ` (${c.fields.join(", ")})` : ""}`,
      ),
    "",
    "## Abgleich Vorgänge",
    "",
    ...reconciliation.history.map(
      (h) => `- ${h.entity}: Extras ${h.source}, in STAY übernommen ${h.imported}`,
    ),
    "",
  ].join("\n");
}
