/**
 * Shadow operation (M3): STAY computes, read-only, what a guest of a reservation would see –
 * services, prices, dates, limits, restrictions, the stay extension offer – with the STAY
 * booking engine (Extras logic, M2 configuration). Nothing is booked; Extras stays leading.
 */
import {
  type GuestCatalog,
  type ServiceBookingEngine,
  type StayExtensionOffer,
} from "@up/integrations";

import { type AdminContext } from "../auth/admin-auth-service";
import { FORBIDDEN_MESSAGE, isAllowed } from "../auth/authorization";

export type ShadowDeps = {
  engine: () => Promise<{ engine: ServiceBookingEngine; source: "apaleo" | "fixture" } | undefined>;
  apaleoPropertyIdOf: (tenantId: string, propertyId: string) => Promise<string | undefined>;
};

export type ShadowResult =
  | {
      ok: true;
      source: "apaleo" | "fixture";
      reservation: {
        id: string;
        arrival: string;
        departure: string;
        status: string;
        unitGroupId: string | null;
        adults: number;
        children: number;
      };
      catalog: GuestCatalog;
      extension: StayExtensionOffer | null;
    }
  | { ok: false; error: string };

const RESERVATION_ID = /^[A-Za-z0-9-]{3,40}$/;

export async function loadShadow(
  deps: ShadowDeps,
  admin: AdminContext,
  propertyId: string,
  reservationId: string,
): Promise<ShadowResult> {
  if (!isAllowed(admin, "catalog.read", { propertyId }))
    return { ok: false, error: FORBIDDEN_MESSAGE };
  if (!RESERVATION_ID.test(reservationId))
    return { ok: false, error: "Bitte eine gültige Reservierungsnummer eingeben." };
  const apaleoPropertyId = await deps.apaleoPropertyIdOf(admin.tenantId, propertyId);
  if (!apaleoPropertyId)
    return { ok: false, error: "Dieses Objekt ist keinem Apaleo-Objekt zugeordnet." };
  const loaded = await deps.engine();
  if (!loaded)
    return { ok: false, error: "Der lesende Apaleo-Zugang ist für STAY nicht eingerichtet." };
  const context = { tenantId: admin.tenantId, propertyId, apaleoPropertyId };
  try {
    const reservation = await loaded.engine.readReservation(reservationId);
    if (!reservation || reservation.property.id !== apaleoPropertyId)
      return { ok: false, error: "Diese Reservierung gibt es für dieses Objekt nicht." };
    const [catalog, extension] = await Promise.all([
      loaded.engine.getGuestCatalog(context, reservation, { includeUnpublished: true }),
      loaded.engine.getStayExtensionOffer(context, reservationId),
    ]);
    return {
      ok: true,
      source: loaded.source,
      reservation: {
        id: reservation.id,
        arrival: reservation.arrival.slice(0, 10),
        departure: reservation.departure.slice(0, 10),
        status: reservation.status,
        unitGroupId: reservation.unitGroup?.id ?? reservation.unit?.unitGroupId ?? null,
        adults: reservation.adults,
        children: reservation.childrenAges?.length ?? 0,
      },
      catalog,
      extension,
    };
  } catch {
    return {
      ok: false,
      error: "Apaleo konnte nicht gelesen werden. Bitte später erneut versuchen.",
    };
  }
}
