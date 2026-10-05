/**
 * The one guest context of the app (ADR 0012): which tenant, property, unit and
 * reservation the current request belongs to. STAY, GUIDE, EXPLORE – and later Extras,
 * Check-in, Access, Chat – read only this; there is no second source of truth.
 *
 * - guest:   from a valid guest session (personal link or booking number login).
 *            The reservation is loaded live from its PMS (guest_access.reservation_provider).
 * - preview: development only (GUEST_ACCESS_MODE=preview, never in production) – the
 *            configured preview reservation, loaded through the very same path.
 *
 * Framework-free and dependency-injected; the request-scoped wiring is in server.ts.
 */
import {
  type Logger,
  type PmsProvider,
  type PmsReservation,
  type ReservationProvider,
} from "@up/core";

import type { HeaderProperty } from "../../components/GuestHeader";
import { findPropertyById, type RegisteredProperty } from "../../config/properties";
import { type CurrentGuestAccess } from "../guest-access/guest-access-service";
import { type StaySource } from "../stay/model";
import { StayMappingError, type StaySourceOptions, toStaySource } from "../stay/to-stay-source";

export type ContextReservation =
  | { status: "loaded"; source: StaySource }
  /** PMS not reachable or reservation not presentable – sections degrade, STAY shows its error. */
  | { status: "unavailable" };

export type GuestContext = {
  mode: "guest" | "preview";
  tenantId: string;
  propertyId: string;
  /** Live unit of the reservation; the access's stored unit while the PMS is unavailable. */
  unitId?: string;
  reservationProvider: ReservationProvider;
  externalReservationId: string;
  /** Only in guest mode. */
  guestAccessId?: string;
  property: RegisteredProperty;
  /** Reference time for phases and visibility (fixed for the mock preview). */
  now: Date;
  reservation: ContextReservation;
};

export type GuestContextResult =
  | { kind: "context"; context: GuestContext }
  /** No valid session (and no preview allowed): the guest must sign in. */
  | { kind: "unauthenticated" }
  /** The session's reservation no longer fits its access (canceled, moved, other tenant). */
  | { kind: "access-invalid" };

export type PreviewReservation = {
  provider: ReservationProvider;
  reservationId: string;
  now: Date;
};

export type GuestContextInput = {
  access: CurrentGuestAccess | undefined;
  /** True only for GUEST_ACCESS_MODE=preview outside production. */
  allowPreview: boolean;
  preview: () => PreviewReservation;
  pmsFor: (provider: ReservationProvider) => PmsProvider | undefined;
  now: Date;
  sourceOptions: StaySourceOptions;
  logger: Logger;
};

/** Safe to log: PmsError and StayMappingError messages contain no secrets or guest data. */
function errorFields(error: unknown): Record<string, unknown> {
  return {
    error: error instanceof Error ? { name: error.name, message: error.message } : "unknown",
    ...(error && typeof error === "object" && "kind" in error ? { kind: error.kind } : {}),
    ...(error && typeof error === "object" && "reason" in error ? { reason: error.reason } : {}),
  };
}

type Load =
  | { status: "loaded"; reservation: PmsReservation; source: StaySource }
  | { status: "unavailable" }
  | { status: "inactive" };

async function loadReservation(
  pms: PmsProvider | undefined,
  reservationId: string,
  input: GuestContextInput,
  dataSource: string,
): Promise<Load> {
  if (!pms) {
    input.logger.error("stay could not be loaded", { dataSource, reason: "pms-not-configured" });
    return { status: "unavailable" };
  }
  let reservation: PmsReservation;
  try {
    reservation = await pms.getReservation(reservationId);
  } catch (error) {
    input.logger.error("stay could not be loaded", { dataSource, ...errorFields(error) });
    return { status: "unavailable" };
  }
  try {
    return {
      status: "loaded",
      reservation,
      source: toStaySource(reservation, input.sourceOptions),
    };
  } catch (error) {
    if (error instanceof StayMappingError && error.reason === "reservation-inactive") {
      return { status: "inactive" };
    }
    input.logger.error("stay could not be loaded", { dataSource, ...errorFields(error) });
    return { status: "unavailable" };
  }
}

async function guestContext(
  access: CurrentGuestAccess,
  input: GuestContextInput,
): Promise<GuestContextResult> {
  const invalid = (reason: string): GuestContextResult => {
    input.logger.warn("guest access does not match reservation", {
      guestAccessId: access.guestAccessId,
      reason,
    });
    return { kind: "access-invalid" };
  };
  const property = findPropertyById(access.propertyId);
  if (!property || property.tenantId !== access.tenantId) return invalid("unknown-property");

  const load = await loadReservation(
    input.pmsFor(access.reservationProvider),
    access.externalReservationId,
    input,
    "session",
  );
  if (load.status === "inactive") return invalid("reservation-inactive");
  if (
    load.status === "loaded" &&
    (load.reservation.externalId !== access.externalReservationId ||
      load.source.tenantId !== access.tenantId ||
      load.source.property.id !== access.propertyId)
  ) {
    return invalid("mismatch");
  }

  const unitId = load.status === "loaded" ? load.source.unit.id : access.unitId;
  return {
    kind: "context",
    context: {
      mode: "guest",
      tenantId: access.tenantId,
      propertyId: access.propertyId,
      ...(unitId ? { unitId } : {}),
      reservationProvider: access.reservationProvider,
      externalReservationId: access.externalReservationId,
      guestAccessId: access.guestAccessId,
      property,
      now: input.now,
      reservation:
        load.status === "loaded"
          ? { status: "loaded", source: load.source }
          : { status: "unavailable" },
    },
  };
}

class PreviewUnavailableError extends Error {
  override name = "PreviewUnavailableError";
}

async function previewContext(input: GuestContextInput): Promise<GuestContextResult> {
  const preview = input.preview();
  const load = await loadReservation(
    input.pmsFor(preview.provider),
    preview.reservationId,
    input,
    preview.provider,
  );
  // Without a loadable preview reservation there is no property to show.
  if (load.status !== "loaded") throw new PreviewUnavailableError("Preview stay unavailable");
  const property = findPropertyById(load.source.property.id);
  if (!property) throw new PreviewUnavailableError("Preview property not registered");
  return {
    kind: "context",
    context: {
      mode: "preview",
      tenantId: load.source.tenantId,
      propertyId: property.id,
      unitId: load.source.unit.id,
      reservationProvider: preview.provider,
      externalReservationId: preview.reservationId,
      property,
      now: preview.now,
      reservation: { status: "loaded", source: load.source },
    },
  };
}

/**
 * Session → context. A valid session always wins; without one, only the development
 * preview may supply a context – secured mode and production never fall back to it.
 */
export async function resolveGuestContext(input: GuestContextInput): Promise<GuestContextResult> {
  if (input.access) return guestContext(input.access, input);
  if (input.allowPreview) return previewContext(input);
  return { kind: "unauthenticated" };
}

/** Stay window for stay-relative content visibility (undefined while not loaded). */
export function stayWindowOf(
  context: GuestContext,
): { checkInAt: string; checkOutAt: string } | undefined {
  if (context.reservation.status !== "loaded") return undefined;
  const { checkInAt, checkOutAt } = context.reservation.source.reservation;
  return { checkInAt, checkOutAt };
}

/** Property identity for the BrandHeader. */
export function headerPropertyOf(property: RegisteredProperty): HeaderProperty {
  return { name: property.name, spokenName: property.spokenName, location: property.location };
}
