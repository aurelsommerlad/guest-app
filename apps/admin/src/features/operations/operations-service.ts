/**
 * Operational administration (M2): extension-night settings, request queue, order history,
 * stay extensions, audit log and import runs. Every function authorizes with the admin's
 * role and property access read on this request.
 *
 * Request decisions are prepared but never write to Apaleo: a confirmation goes through the
 * central write gateway, which is `disabled` (or `simulated` on staging). Requests imported
 * from Extras stay with Extras until the joint go-live.
 */
import { type AdminPermission, type Logger, type StayExtensionSettings } from "@up/core";
import {
  type AdminAuditEvent,
  type Database,
  decideOfferRequest,
  getMigrationRun,
  getOfferRequestForAdmin,
  getPropertyServiceSettings,
  getServiceBooking,
  getStayExtension,
  listAdminAuditEvents,
  listMigrationRuns,
  listOfferRequestsForAdmin,
  listPropertiesForTenant,
  listServiceBookings,
  listStayExtensions,
  type OfferRequestRow,
  type PropertyServiceSettings,
  recordAdminAuditEvent,
  upsertPropertyServiceSettings,
} from "@up/db";
import { type ServiceWriteGateway } from "@up/integrations";

import { type AdminContext } from "../auth/admin-auth-service";
import { FORBIDDEN_MESSAGE, isAllowed, visibleProperties } from "../auth/authorization";

export type OperationsDeps = {
  db: Database;
  logger: Logger;
  now: () => Date;
  gateway: () => ServiceWriteGateway;
  apaleoPropertyIdOf: (tenantId: string, propertyId: string) => Promise<string | undefined>;
};

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export type PropertyOption = { id: string; displayName: string };

const tenantOf = (admin: AdminContext) => ({ tenantId: admin.tenantId });
const restrictedIds = (admin: AdminContext) =>
  admin.role !== "owner" && admin.propertyScope === "selected" ? admin.propertyIds : undefined;

async function propertiesFor(deps: OperationsDeps, admin: AdminContext): Promise<PropertyOption[]> {
  return visibleProperties(admin, await listPropertiesForTenant(deps.db, tenantOf(admin))).map(
    (p) => ({
      id: p.id,
      displayName: p.displayName,
    }),
  );
}

/** Lists of one module: permission, property access and the visible properties. */
async function listScope(
  deps: OperationsDeps,
  admin: AdminContext,
  permission: AdminPermission,
  viewProperty: string | null,
): Promise<Result<{ properties: PropertyOption[]; propertyIds: readonly string[] | undefined }>> {
  if (!isAllowed(admin, permission, viewProperty ? { propertyId: viewProperty } : {})) {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }
  const properties = await propertiesFor(deps, admin);
  if (viewProperty && !properties.some((p) => p.id === viewProperty))
    return { ok: false, error: FORBIDDEN_MESSAGE };
  return {
    ok: true,
    properties,
    propertyIds: viewProperty ? [viewProperty] : restrictedIds(admin),
  };
}

/* ── Extension nights ─────────────────────────────────────────────────────────────────── */

export type ExtensionSettingsRow = {
  property: PropertyOption;
  settings: PropertyServiceSettings;
  canEdit: boolean;
};

export async function loadExtensionSettings(
  deps: OperationsDeps,
  admin: AdminContext,
  viewProperty: string | null,
): Promise<Result<{ rows: ExtensionSettingsRow[] }>> {
  const scope = await listScope(deps, admin, "settings.read", viewProperty);
  if (!scope.ok) return scope;
  const shown = viewProperty
    ? scope.properties.filter((p) => p.id === viewProperty)
    : scope.properties;
  const rows = await Promise.all(
    shown.map(async (property) => ({
      property,
      settings: await getPropertyServiceSettings(deps.db, tenantOf(admin), property.id),
      canEdit: isAllowed(admin, "settings.edit", { propertyId: property.id }),
    })),
  );
  return { ok: true, rows };
}

export type ExtensionSettingsForm = {
  extensionNightEnabled: boolean;
  discountPreArrivalOneNightGap: string;
  discountPreArrivalStandard: string;
  discountInHouseOneNightGap: string;
  discountInHouseStandard: string;
  minSellableStayNights: string;
};

function percent(value: string): number | null {
  const text = value.trim();
  if (text === "") return 0; // empty = 0 % (decision 08.11.2026)
  const n = Number(text.replace(",", "."));
  return Number.isInteger(n) && n >= 0 && n <= 90 ? n : null;
}

export function parseExtensionSettingsForm(
  form: ExtensionSettingsForm,
): Result<{ settings: StayExtensionSettings }> {
  const values = [
    percent(form.discountPreArrivalOneNightGap),
    percent(form.discountPreArrivalStandard),
    percent(form.discountInHouseOneNightGap),
    percent(form.discountInHouseStandard),
  ];
  if (values.some((v) => v === null))
    return { ok: false, error: "Rabatte sind ganze Prozentwerte von 0 bis 90." };
  const minNights = Number(form.minSellableStayNights);
  if (!Number.isInteger(minNights) || minNights < 1 || minNights > 30) {
    return { ok: false, error: "Die Mindestbelegung ist eine ganze Zahl von 1 bis 30 Nächten." };
  }
  const [a, b, c, d] = values as number[];
  return {
    ok: true,
    settings: {
      extensionNightEnabled: form.extensionNightEnabled,
      extensionDiscountPreArrivalOneNightGap: a ?? 0,
      extensionDiscountPreArrivalStandard: b ?? 0,
      extensionDiscountInHouseOneNightGap: c ?? 0,
      extensionDiscountInHouseStandard: d ?? 0,
      minSellableStayNights: minNights,
    },
  };
}

export async function saveExtensionSettings(
  deps: OperationsDeps,
  admin: AdminContext,
  propertyId: string,
  form: ExtensionSettingsForm,
): Promise<Result> {
  if (!isAllowed(admin, "settings.edit", { propertyId }))
    return { ok: false, error: FORBIDDEN_MESSAGE };
  const properties = await propertiesFor(deps, admin);
  if (!properties.some((p) => p.id === propertyId))
    return { ok: false, error: "Dieses Objekt gibt es nicht." };
  const parsed = parseExtensionSettingsForm(form);
  if (!parsed.ok) return parsed;
  const current = await getPropertyServiceSettings(deps.db, tenantOf(admin), propertyId);
  await upsertPropertyServiceSettings(deps.db, tenantOf(admin), {
    propertyId,
    settings: { ...parsed.settings, slackRoute: current.slackRoute },
    actorAdminId: admin.adminUserId,
  });
  return { ok: true };
}

/* ── Requests ─────────────────────────────────────────────────────────────────────────── */

export async function loadRequests(
  deps: OperationsDeps,
  admin: AdminContext,
  viewProperty: string | null,
  status?: OfferRequestRow["status"],
): Promise<Result<{ requests: OfferRequestRow[]; properties: PropertyOption[] }>> {
  const scope = await listScope(deps, admin, "requests.read", viewProperty);
  if (!scope.ok) return scope;
  const requests = await listOfferRequestsForAdmin(deps.db, tenantOf(admin), {
    ...(scope.propertyIds ? { propertyIds: scope.propertyIds } : {}),
    ...(status ? { status } : {}),
  });
  return { ok: true, requests, properties: scope.properties };
}

export async function loadRequest(
  deps: OperationsDeps,
  admin: AdminContext,
  requestId: string,
): Promise<
  Result<{ request: OfferRequestRow; canDecide: boolean; property: PropertyOption | undefined }>
> {
  const request = await getOfferRequestForAdmin(deps.db, tenantOf(admin), requestId);
  if (!request || !isAllowed(admin, "requests.read", { propertyId: request.propertyId })) {
    return { ok: false, error: "Diese Anfrage gibt es nicht." };
  }
  const properties = await propertiesFor(deps, admin);
  return {
    ok: true,
    request,
    property: properties.find((p) => p.id === request.propertyId),
    canDecide:
      request.source === "stay" &&
      request.status === "pending" &&
      isAllowed(admin, "requests.decide", { propertyId: request.propertyId }),
  };
}

export type DecisionOutcome = { ok: true; message: string } | { ok: false; error: string };

/**
 * Prepared approval: a confirmation is only recorded when the write gateway accepted the
 * Apaleo booking (in M2 at most `simulated`). With writes disabled the request stays pending
 * and the attempt is audited. Declining needs no Apaleo write.
 */
export async function decideRequest(
  deps: OperationsDeps,
  admin: AdminContext,
  requestId: string,
  decision: "confirm" | "decline",
): Promise<DecisionOutcome> {
  const request = await getOfferRequestForAdmin(deps.db, tenantOf(admin), requestId);
  if (!request || !isAllowed(admin, "requests.read", { propertyId: request.propertyId })) {
    return { ok: false, error: "Diese Anfrage gibt es nicht." };
  }
  if (!isAllowed(admin, "requests.decide", { propertyId: request.propertyId }))
    return { ok: false, error: FORBIDDEN_MESSAGE };
  if (request.source === "extras") {
    return {
      ok: false,
      error: "Diese Anfrage stammt aus der Extras-App und wird bis zum Go-live dort bearbeitet.",
    };
  }
  if (request.status !== "pending")
    return { ok: false, error: "Diese Anfrage ist bereits entschieden." };
  const now = deps.now();

  if (decision === "decline") {
    const result = await decideOfferRequest(deps.db, tenantOf(admin), {
      requestId,
      decision: "declined",
      actorAdminId: admin.adminUserId,
      now,
    });
    return result.ok
      ? { ok: true, message: "Anfrage abgelehnt." }
      : { ok: false, error: "Die Anfrage konnte nicht abgelehnt werden." };
  }

  const apaleoPropertyId = await deps.apaleoPropertyIdOf(admin.tenantId, request.propertyId);
  const dates = request.requestedDates?.length
    ? request.requestedDates
    : request.requestedDate
      ? [request.requestedDate]
      : [];
  if (!apaleoPropertyId || !request.apaleoServiceId || !dates.length) {
    return {
      ok: false,
      error: "Für diese Anfrage fehlen Apaleo-Objekt, Service oder Datum – keine Buchung möglich.",
    };
  }
  const outcome = await deps.gateway().execute({
    tenantId: admin.tenantId,
    propertyId: request.propertyId,
    apaleoPropertyId,
    reservationId: request.externalReservationId,
    idempotencyKey: `request:${request.id}:confirm`,
    trigger: "admin",
    actorAdminId: admin.adminUserId,
    command: {
      operation: "book-service",
      serviceId: request.apaleoServiceId,
      dates: dates.map((serviceDate) => ({ serviceDate, count: request.quantity ?? 1 })),
    },
  });
  if (outcome.status === "simulated" || outcome.status === "succeeded") {
    const result = await decideOfferRequest(deps.db, tenantOf(admin), {
      requestId,
      decision: "confirmed",
      actorAdminId: admin.adminUserId,
      now,
      bookedServiceDates: dates,
      writeResult: outcome.status,
    });
    if (!result.ok) return { ok: false, error: "Die Anfrage konnte nicht bestätigt werden." };
    return {
      ok: true,
      message:
        outcome.status === "simulated"
          ? "Bestätigt (simuliert – es wurde nichts an Apaleo gesendet)."
          : "Bestätigt.",
    };
  }
  await recordAdminAuditEvent(deps.db, tenantOf(admin), {
    actorType: "admin",
    actorAdminId: admin.adminUserId,
    propertyId: request.propertyId,
    action: "request.confirm_blocked",
    entityType: "offer_request",
    entityId: request.id,
    details: { gateway: outcome.status, code: "code" in outcome ? outcome.code : "in_progress" },
  });
  if (outcome.status === "blocked" && outcome.code === "writes_disabled") {
    return {
      ok: false,
      error:
        "Buchungen in Apaleo sind aus STAY noch nicht freigegeben. Die Anfrage bleibt offen; der Versuch ist protokolliert.",
    };
  }
  return {
    ok: false,
    error: `Die Buchung wurde nicht ausgeführt (${"code" in outcome ? outcome.code : "läuft bereits"}). Die Anfrage bleibt offen.`,
  };
}

/* ── Orders, extensions ───────────────────────────────────────────────────────────────── */

export async function loadBookings(
  deps: OperationsDeps,
  admin: AdminContext,
  viewProperty: string | null,
) {
  const scope = await listScope(deps, admin, "bookings.read", viewProperty);
  if (!scope.ok) return scope;
  const bookings = await listServiceBookings(
    deps.db,
    tenantOf(admin),
    scope.propertyIds ? { propertyIds: scope.propertyIds } : {},
  );
  return { ok: true as const, bookings, properties: scope.properties };
}

export async function loadBooking(deps: OperationsDeps, admin: AdminContext, bookingId: string) {
  const booking = await getServiceBooking(deps.db, tenantOf(admin), bookingId);
  if (!booking || !isAllowed(admin, "bookings.read", { propertyId: booking.propertyId }))
    return undefined;
  return booking;
}

export async function loadExtensions(
  deps: OperationsDeps,
  admin: AdminContext,
  viewProperty: string | null,
) {
  const scope = await listScope(deps, admin, "bookings.read", viewProperty);
  if (!scope.ok) return scope;
  const extensions = await listStayExtensions(
    deps.db,
    tenantOf(admin),
    scope.propertyIds ? { propertyIds: scope.propertyIds } : {},
  );
  return { ok: true as const, extensions, properties: scope.properties };
}

export async function loadExtension(
  deps: OperationsDeps,
  admin: AdminContext,
  extensionId: string,
) {
  const extension = await getStayExtension(deps.db, tenantOf(admin), extensionId);
  if (!extension || !isAllowed(admin, "bookings.read", { propertyId: extension.propertyId }))
    return undefined;
  return extension;
}

/* ── Audit and imports ────────────────────────────────────────────────────────────────── */

export async function loadAudit(
  deps: OperationsDeps,
  admin: AdminContext,
): Promise<Result<{ events: AdminAuditEvent[] }>> {
  if (!isAllowed(admin, "settings.read")) return { ok: false, error: FORBIDDEN_MESSAGE };
  const propertyIds = restrictedIds(admin);
  const events = await listAdminAuditEvents(deps.db, tenantOf(admin), {
    limit: 300,
    ...(propertyIds ? { propertyIds } : {}),
  });
  return { ok: true, events };
}

export async function loadImports(deps: OperationsDeps, admin: AdminContext) {
  if (!isAllowed(admin, "migration.run")) return { ok: false as const, error: FORBIDDEN_MESSAGE };
  return { ok: true as const, runs: await listMigrationRuns(deps.db, tenantOf(admin)) };
}

export async function loadImport(deps: OperationsDeps, admin: AdminContext, runId: string) {
  if (!isAllowed(admin, "migration.run")) return undefined;
  return getMigrationRun(deps.db, tenantOf(admin), runId);
}
