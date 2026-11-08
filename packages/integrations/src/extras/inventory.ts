/**
 * Redacted inventory of an Extras snapshot (M0 report): volumes, variants, anomalies and
 * possible data loss. Contains counts, ids of services/properties and configuration values
 * only – never user names, guest names, e-mail addresses, passwords or tokens.
 */
import { entriesMatching, type Manifest, type Snapshot } from "./snapshot";

type Item = Record<string, unknown>;

const asObject = (value: unknown): Item =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Item) : {};
const asArray = (value: unknown): Item[] => (Array.isArray(value) ? value.map(asObject) : []);
const count = (map: Record<string, number>, key: string) => {
  map[key] = (map[key] ?? 0) + 1;
};
const day = (value: unknown) => (typeof value === "string" ? value.slice(0, 10) : null);

export type PropertyCatalogInventory = {
  propertyId: string;
  items: number;
  active: number;
  actionTypes: Record<string, number>;
  bookingRules: Record<string, number>;
  fulfillmentModes: Record<string, number>;
  flags: {
    requiresRemainingCapacity: number;
    requiresVehicleRegistration: number;
    maxOnePerReservation: number;
  };
  unitGroupRestricted: number;
  withImage: number;
  withLanguageOverrides: number;
  withoutSortOrder: number;
  codes: string[];
};

export type Inventory = {
  snapshot: {
    createdAt: string;
    source: string;
    sha256: string;
    keys: number;
    bytes: number;
    dbsize: number;
  };
  properties: string[];
  catalog: PropertyCatalogInventory[];
  sharedServiceCodes: { code: string; properties: number }[];
  extensionConfigs: { propertyId: string; config: Item }[];
  images: {
    count: number;
    bytes: number;
    referenced: number;
    unreferenced: number;
    missing: number;
    contentTypes: Record<string, number>;
  };
  users: { count: number; roles: Record<string, number> };
  orders: {
    count: number;
    byProperty: Record<string, number>;
    items: number;
    firstDay: string | null;
    lastDay: string | null;
    capReached: boolean;
  };
  requests: {
    count: number;
    byStatus: Record<string, number>;
    byProperty: Record<string, number>;
    open: number;
  };
  extensions: {
    count: number;
    byStatus: Record<string, number>;
    byProperty: Record<string, number>;
  };
  ephemeral: { count: number; withoutExpiry: number; byNamespace: Record<string, number> };
  removedFields: Record<string, number>;
  unknownKeys: number;
  anomalies: string[];
};

const ORDER_CAP = 500;
const KNOWN = {
  actionType: ["service", "increase_occupancy"],
  bookingRule: ["per_stay", "per_night", "arrival_day", "departure_day"],
  fulfillmentMode: ["instant", "request"],
  role: ["admin", "manager", "viewer"],
  requestStatus: ["pending", "approved", "rejected"],
};

function imageIdOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const match = /\/api\/images\/([0-9a-f-]{36})/i.exec(url);
  return match?.[1] ?? null;
}

export function buildInventory(snapshot: Snapshot, manifest: Manifest): Inventory {
  const anomalies: string[] = [];
  const catalogEntries = entriesMatching(snapshot, "catalog:*:items");
  const legacyCatalogs = snapshot.entries.filter((e) => /^catalog:[^:]+$/.test(e.key));
  const referencedImages = new Set<string>();
  const codeProperties = new Map<string, Set<string>>();

  const catalog: PropertyCatalogInventory[] = catalogEntries.map((entry) => {
    const propertyId = entry.key.split(":")[1] ?? "?";
    const items = Object.entries(asObject(entry.value)).map(([field, value]) => ({
      field,
      item: asObject(value),
    }));
    const inv: PropertyCatalogInventory = {
      propertyId,
      items: items.length,
      active: 0,
      actionTypes: {},
      bookingRules: {},
      fulfillmentModes: {},
      flags: {
        requiresRemainingCapacity: 0,
        requiresVehicleRegistration: 0,
        maxOnePerReservation: 0,
      },
      unitGroupRestricted: 0,
      withImage: 0,
      withLanguageOverrides: 0,
      withoutSortOrder: 0,
      codes: [],
    };
    for (const { field, item } of items) {
      const serviceId = typeof item.serviceId === "string" ? item.serviceId : "";
      if (serviceId !== field)
        anomalies.push(
          `catalog ${propertyId}: Feld ${field} enthält serviceId ${serviceId || "(leer)"}`,
        );
      if (item.active === true) inv.active++;
      const actionType = typeof item.actionType === "string" ? item.actionType : "service";
      const bookingRule = typeof item.bookingRule === "string" ? item.bookingRule : "per_stay";
      const fulfillment =
        typeof item.fulfillmentMode === "string" ? item.fulfillmentMode : "instant";
      count(inv.actionTypes, actionType);
      count(inv.bookingRules, bookingRule);
      count(inv.fulfillmentModes, fulfillment);
      if (!KNOWN.actionType.includes(actionType))
        anomalies.push(`catalog ${propertyId}/${serviceId}: unbekannter actionType ${actionType}`);
      if (!KNOWN.bookingRule.includes(bookingRule))
        anomalies.push(`catalog ${propertyId}/${serviceId}: unbekannte bookingRule ${bookingRule}`);
      if (!KNOWN.fulfillmentMode.includes(fulfillment))
        anomalies.push(
          `catalog ${propertyId}/${serviceId}: unbekannter fulfillmentMode ${fulfillment}`,
        );
      if (item.requiresRemainingCapacity === true) inv.flags.requiresRemainingCapacity++;
      if (item.requiresVehicleRegistration === true) inv.flags.requiresVehicleRegistration++;
      if (item.maxOnePerReservation === true) inv.flags.maxOnePerReservation++;
      if (Array.isArray(item.allowedUnitGroupIds) && item.allowedUnitGroupIds.length)
        inv.unitGroupRestricted++;
      if (typeof item.imageUrl === "string" && item.imageUrl) {
        inv.withImage++;
        const id = imageIdOf(item.imageUrl);
        if (id) referencedImages.add(id);
        else anomalies.push(`catalog ${propertyId}/${serviceId}: externes Bild (kein KV-Bild)`);
      }
      if (
        ["displayNameDe", "displayNameEn", "descriptionDe", "descriptionEn"].some(
          (k) => typeof item[k] === "string" && item[k],
        )
      )
        inv.withLanguageOverrides++;
      if (typeof item.sortOrder !== "number") inv.withoutSortOrder++;
      if (
        actionType === "increase_occupancy" &&
        (item.extraPersonPricePerNight === null ||
          item.extraPersonPricePerNight === undefined ||
          item.extraPersonPricePerNight === "")
      ) {
        anomalies.push(
          `catalog ${propertyId}/${serviceId}: Zusatzperson ohne Preis (Extras berechnet 0 €, STAY verweigert)`,
        );
      }
      if (actionType === "increase_occupancy" && fulfillment !== "instant")
        anomalies.push(`catalog ${propertyId}/${serviceId}: Zusatzperson nicht sofort buchbar`);
      const code = typeof item.code === "string" && item.code ? item.code : null;
      if (!code)
        anomalies.push(
          `catalog ${propertyId}/${serviceId}: kein Service-Code (Zuordnung nur über serviceId)`,
        );
      const groupKey = code ?? serviceId;
      inv.codes.push(groupKey);
      if (!codeProperties.has(groupKey)) codeProperties.set(groupKey, new Set());
      codeProperties.get(groupKey)?.add(propertyId);
    }
    inv.codes.sort();
    return inv;
  });
  for (const legacy of legacyCatalogs) {
    const propertyId = legacy.key.split(":")[1] ?? "?";
    const migrated = catalogEntries.some((e) => e.key === `catalog:${propertyId}:items`);
    anomalies.push(
      migrated
        ? `catalog ${propertyId}: alter Array-Katalog noch vorhanden (bereits migriert, wird ignoriert)`
        : `catalog ${propertyId}: nur alter Array-Katalog vorhanden (noch nie im Extras-Admin geöffnet)`,
    );
  }

  const extensionConfigs = entriesMatching(snapshot, "extension-night:config:*").map((entry) => ({
    propertyId: entry.key.split(":")[2] ?? "?",
    config: asObject(entry.value),
  }));
  for (const { propertyId, config } of extensionConfigs) {
    if ("extensionDiscountOneNightGap" in config || "extensionDiscountStandard" in config) {
      anomalies.push(
        `extension ${propertyId}: Altfelder (einheitlicher Rabatt) vorhanden – Phasenrabatte werden daraus abgeleitet`,
      );
    }
    for (const [key, value] of Object.entries(config)) {
      if (key.startsWith("extensionDiscount") && (value === null || value === "")) {
        anomalies.push(
          `extension ${propertyId}: ${key} leer (Extras rechnet 0 %, STAY nutzt Altfeld/Standard)`,
        );
      }
    }
  }

  const images = entriesMatching(snapshot, "image:*");
  const imageIds = new Set(images.map((e) => e.key.slice("image:".length)));
  const contentTypes: Record<string, number> = {};
  let imageBytes = 0;
  for (const image of images) {
    const value = asObject(image.value);
    count(contentTypes, typeof value.contentType === "string" ? value.contentType : "unbekannt");
    imageBytes += typeof value.base64 === "string" ? Math.floor((value.base64.length * 3) / 4) : 0;
  }
  const missing = [...referencedImages].filter((id) => !imageIds.has(id));
  for (const id of missing)
    anomalies.push(`image ${id.slice(0, 8)}…: im Katalog verwendet, aber nicht im Speicher`);

  const users = asArray(entriesMatching(snapshot, "users")[0]?.value);
  const roles: Record<string, number> = {};
  for (const user of users) {
    const role = typeof user.role === "string" ? user.role : "unbekannt";
    count(roles, role);
    if (!KNOWN.role.includes(role)) anomalies.push(`users: unbekannte Rolle ${role}`);
  }

  const orders = asArray(entriesMatching(snapshot, "orders")[0]?.value);
  const orderByProperty: Record<string, number> = {};
  let orderItems = 0;
  const orderDays: string[] = [];
  for (const order of orders) {
    count(orderByProperty, typeof order.propertyId === "string" ? order.propertyId : "?");
    orderItems += asArray(order.items).length;
    const d = day(order.createdAt);
    if (d) orderDays.push(d);
  }
  orderDays.sort();
  const capReached = orders.length >= ORDER_CAP;
  if (capReached)
    anomalies.push(
      `orders: Obergrenze ${ORDER_CAP} erreicht – ältere Bestellungen sind in Extras bereits verloren`,
    );

  const requests = Object.values(
    asObject(entriesMatching(snapshot, "requests:items")[0]?.value),
  ).map(asObject);
  const byStatus: Record<string, number> = {};
  const requestByProperty: Record<string, number> = {};
  for (const request of requests) {
    const status = typeof request.status === "string" ? request.status : "?";
    count(byStatus, status);
    count(requestByProperty, typeof request.propertyId === "string" ? request.propertyId : "?");
    if (!KNOWN.requestStatus.includes(status))
      anomalies.push(`requests: unbekannter Status ${status}`);
  }

  const extensions = Object.values(
    asObject(entriesMatching(snapshot, "stay-extensions:records")[0]?.value),
  ).map(asObject);
  const extensionStatus: Record<string, number> = {};
  const extensionProperty: Record<string, number> = {};
  for (const record of extensions) {
    count(extensionStatus, typeof record.status === "string" ? record.status : "?");
    const pid =
      typeof record.propertyId === "string" ? record.propertyId : "(ohne Objekt – Altdatensatz)";
    count(extensionProperty, pid);
  }

  const ephemeralByNamespace: Record<string, number> = {};
  let withoutExpiry = 0;
  for (const key of snapshot.ephemeral) {
    count(
      ephemeralByNamespace,
      key.key
        .split(":")
        .slice(0, key.key.includes(":claim:") ? 2 : 1)
        .join(":"),
    );
    if (key.ttl === -1) withoutExpiry++;
  }
  if (withoutExpiry)
    anomalies.push(
      `locks: ${withoutExpiry} Sperr-/Hilfsschlüssel ohne Ablaufzeit (hängende Sperren möglich)`,
    );
  if (snapshot.unknownKeys.length)
    anomalies.push(`${snapshot.unknownKeys.length} Schlüssel in keinem bekannten Namensraum`);

  const properties = [
    ...new Set([...catalog.map((c) => c.propertyId), ...extensionConfigs.map((e) => e.propertyId)]),
  ].sort();
  return {
    snapshot: {
      createdAt: snapshot.createdAt,
      source: snapshot.source.label,
      sha256: manifest.snapshotSha256,
      keys: manifest.entries.length,
      bytes: manifest.entries.reduce((sum, e) => sum + e.bytes, 0),
      dbsize: snapshot.dbsize,
    },
    properties,
    catalog,
    sharedServiceCodes: [...codeProperties.entries()]
      .filter(([, set]) => set.size > 1)
      .map(([code, set]) => ({ code, properties: set.size }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    extensionConfigs,
    images: {
      count: images.length,
      bytes: imageBytes,
      referenced: [...referencedImages].filter((id) => imageIds.has(id)).length,
      unreferenced: [...imageIds].filter((id) => !referencedImages.has(id)).length,
      missing: missing.length,
      contentTypes,
    },
    users: { count: users.length, roles },
    orders: {
      count: orders.length,
      byProperty: orderByProperty,
      items: orderItems,
      firstDay: orderDays[0] ?? null,
      lastDay: orderDays[orderDays.length - 1] ?? null,
      capReached,
    },
    requests: {
      count: requests.length,
      byStatus,
      byProperty: requestByProperty,
      open: byStatus.pending ?? 0,
    },
    extensions: {
      count: extensions.length,
      byStatus: extensionStatus,
      byProperty: extensionProperty,
    },
    ephemeral: {
      count: snapshot.ephemeral.length,
      withoutExpiry,
      byNamespace: ephemeralByNamespace,
    },
    removedFields: snapshot.removedFields,
    unknownKeys: snapshot.unknownKeys.length,
    anomalies,
  };
}

const list = (map: Record<string, number>) =>
  Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ") || "–";

export function renderInventoryMarkdown(inv: Inventory): string {
  const lines: string[] = [
    "# Extras-Bestandsaufnahme (M0)",
    "",
    "Automatisch erzeugt aus einem minimierten Export. Enthält keine Gastnamen, E-Mail-Adressen, Benutzernamen, Passwörter oder Tokens.",
    "",
    "## Export",
    "",
    `- Zeitpunkt: ${inv.snapshot.createdAt}`,
    `- Quelle: ${inv.snapshot.source}`,
    `- Schlüssel exportiert: ${inv.snapshot.keys} (Datenbank gesamt: ${inv.snapshot.dbsize})`,
    `- Umfang: ${Math.round(inv.snapshot.bytes / 1024)} KB`,
    `- Prüfsumme (SHA-256): \`${inv.snapshot.sha256}\``,
    `- Beim Export entfernte Felder: ${list(inv.removedFields)}`,
    "",
    "## Katalog je Objekt",
    "",
    "| Objekt | Services | aktiv | Aktion | Buchungsregel | Modus | Kapazität | Kennzeichen | max. 1 | Apartmenttypen | Bild | Sprach-Overrides | ohne Reihenfolge |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...inv.catalog.map(
      (c) =>
        `| ${c.propertyId} | ${c.items} | ${c.active} | ${list(c.actionTypes)} | ${list(c.bookingRules)} | ${list(c.fulfillmentModes)} | ${c.flags.requiresRemainingCapacity} | ${c.flags.requiresVehicleRegistration} | ${c.flags.maxOnePerReservation} | ${c.unitGroupRestricted} | ${c.withImage} | ${c.withLanguageOverrides} | ${c.withoutSortOrder} |`,
    ),
    "",
    `Service-Codes an mehreren Objekten (Kandidaten für einen zentralen Katalogeintrag): ${inv.sharedServiceCodes.map((s) => `${s.code} (${s.properties})`).join(", ") || "–"}`,
    "",
    "## Verlängerungsnächte",
    "",
    ...inv.extensionConfigs.map(
      (e) =>
        `- ${e.propertyId}: ${Object.entries(e.config)
          .filter(([k]) => k !== "updatedAt")
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(", ")}`,
    ),
    ...(inv.extensionConfigs.length ? [] : ["- keine Konfiguration gespeichert (Standardwerte)"]),
    "",
    "## Bilder",
    "",
    `- ${inv.images.count} Bilder, ${Math.round(inv.images.bytes / 1024)} KB; verwendet ${inv.images.referenced}, unbenutzt ${inv.images.unreferenced}, fehlend ${inv.images.missing}`,
    `- Formate: ${list(inv.images.contentTypes)}`,
    "",
    "## Benutzer und Rollen",
    "",
    `- ${inv.users.count} Konten (${list(inv.users.roles)}). Passwörter werden nicht übernommen; jede Person erhält eine STAY-Einladung.`,
    "",
    "## Vorgänge",
    "",
    `- Bestellungen: ${inv.orders.count} (${inv.orders.items} Positionen), ${inv.orders.firstDay ?? "–"} bis ${inv.orders.lastDay ?? "–"}; je Objekt: ${list(inv.orders.byProperty)}`,
    `- Anfragen: ${inv.requests.count}, offen ${inv.requests.open}; Status: ${list(inv.requests.byStatus)}; je Objekt: ${list(inv.requests.byProperty)}`,
    `- Verlängerungen: ${inv.extensions.count}; Status: ${list(inv.extensions.byStatus)}; je Objekt: ${list(inv.extensions.byProperty)}`,
    `- Kurzlebige Schlüssel (nicht exportiert): ${inv.ephemeral.count}, davon ohne Ablauf ${inv.ephemeral.withoutExpiry}; ${list(inv.ephemeral.byNamespace)}`,
    "",
    "## Auffälligkeiten und mögliche Datenverluste",
    "",
    ...(inv.anomalies.length ? inv.anomalies.map((a) => `- ${a}`) : ["- keine"]),
    "",
  ];
  return lines.join("\n");
}
