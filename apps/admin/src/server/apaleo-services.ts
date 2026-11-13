import "server-only";

import {
  createServiceLockStore,
  createServiceRecordStore,
  createServiceWriteStore,
  getPropertyExternalId,
} from "@up/db";
import {
  ApaleoClient,
  ApaleoServiceReader,
  ServiceBookingEngine,
  ServiceWriteGateway,
} from "@up/integrations";

import { serverEnv } from "../env/server";
import { type ApaleoServiceSource, fixtureServiceSource } from "../features/services/apaleo-source";
import { getDatabase } from "./database";
import { logger } from "./logger";

let reader: ApaleoServiceReader | undefined;

function apaleoReader(): ApaleoServiceReader | undefined {
  if (!serverEnv.APALEO_CLIENT_ID || !serverEnv.APALEO_CLIENT_SECRET) return undefined;
  reader ??= new ApaleoServiceReader(
    new ApaleoClient({
      clientId: serverEnv.APALEO_CLIENT_ID,
      clientSecret: serverEnv.APALEO_CLIENT_SECRET,
      logger,
    }),
  );
  return reader;
}

/** Where the admin reads the Apaleo services and unit groups of a property (read-only). */
export function apaleoServiceSource(): ApaleoServiceSource | undefined {
  const live = apaleoReader();
  if (live) {
    return {
      kind: "apaleo",
      listServices: async (propertyId) =>
        (await live.listServiceDefinitions(propertyId)).map((service) => ({
          id: service.id,
          name: service.name ?? service.id,
          code: service.code ?? null,
          mode: service.availability?.mode ?? null,
          defaultGrossPrice: service.defaultGrossPrice ?? null,
        })),
      listUnitGroups: async (propertyId) =>
        (await live.listUnitGroups(propertyId)).map((group) => ({
          id: group.id,
          name: group.name ?? group.id,
          maxPersons: group.maxPersons ?? null,
        })),
    };
  }
  return serverEnv.APP_ENV === "local" && serverEnv.APALEO_SERVICE_FIXTURES === "on"
    ? fixtureServiceSource
    : undefined;
}

export function apaleoPropertyIdOf(tenantId: string, propertyId: string) {
  return getPropertyExternalId(getDatabase(), { tenantId }, propertyId);
}

/**
 * The central write gateway as configured for this environment: `disabled` unless
 * APALEO_SERVICE_WRITES=simulated. Nothing is ever sent to Apaleo from here.
 */
export function serviceWriteGateway(): ServiceWriteGateway {
  const live = apaleoReader();
  return new ServiceWriteGateway({
    mode: serverEnv.APALEO_SERVICE_WRITES,
    allowedApaleoPropertyIds: (serverEnv.APALEO_SERVICE_WRITE_PROPERTIES ?? "")
      .split(",")
      .filter(Boolean),
    store: createServiceWriteStore(getDatabase()),
    lookupReservation: async (reservationId) => {
      if (!live) throw new Error("apaleo_not_configured");
      const reservation = await live.getReservation(reservationId);
      return { property: reservation.property, status: reservation.status };
    },
  });
}

/** The STAY booking engine (Extras logic) on a gateway; needs the read-only Apaleo access. */
export async function serviceBookingEngine(
  gateway: ServiceWriteGateway,
): Promise<ServiceBookingEngine | undefined> {
  const live = apaleoReader();
  if (!live) return undefined;
  const db = getDatabase();
  // Local browser tests against the guest-services Apaleo simulator: apply simulated writes
  // to the simulator state (APALEO_SIM_STATE) so guest and admin see the same result.
  const simulator =
    serverEnv.APP_ENV === "local" && process.env.APALEO_SIM_STATE
      ? (await import("@up/shadow/simulator-state")).applyToSimulator
      : undefined;
  const effective = simulator
    ? new ServiceWriteGateway({
        mode: gateway.mode,
        allowedApaleoPropertyIds: (serverEnv.APALEO_SERVICE_WRITE_PROPERTIES ?? "")
          .split(",")
          .filter(Boolean),
        store: createServiceWriteStore(db),
        lookupReservation: async (id) => {
          const reservation = await live.getReservation(id);
          return { property: reservation.property, status: reservation.status };
        },
        onSimulated: simulator,
      })
    : gateway;
  return new ServiceBookingEngine({
    reader: live,
    gateway: effective,
    records: createServiceRecordStore(db),
    locks: createServiceLockStore(db),
    verifySimulatedWrites: simulator ? "check" : "skip",
  });
}

/**
 * Local development only (APP_ENV=local, APALEO_SERVICE_FIXTURES=on): the booking engine on the
 * in-memory Apaleo double of @up/shadow (TEST data). Never available on staging/production.
 */
async function localFixtureEngine(
  mode: ServiceWriteGateway["mode"],
): Promise<ServiceBookingEngine | undefined> {
  if (serverEnv.APP_ENV !== "local" || serverEnv.APALEO_SERVICE_FIXTURES !== "on") return undefined;
  const { ApaleoDouble } = await import("@up/shadow/apaleo-double");
  const double = new ApaleoDouble({ arrival: "2027-01-12", departure: "2027-01-14" });
  const fixtureReader = new ApaleoServiceReader(
    new ApaleoClient({ clientId: "fixture", clientSecret: "fixture", logger, fetch: double.fetch }),
  );
  const db = getDatabase();
  return new ServiceBookingEngine({
    reader: fixtureReader,
    gateway: new ServiceWriteGateway({
      mode,
      allowedApaleoPropertyIds: ["TEST"],
      store: createServiceWriteStore(db),
      lookupReservation: (id) => fixtureReader.getReservation(id),
      onSimulated: double.applySimulated,
    }),
    records: createServiceRecordStore(db),
    locks: createServiceLockStore(db),
  });
}

/** Engine for request decisions: live Apaleo reader, or the local fixture double. */
export async function decisionEngine(
  gateway: ServiceWriteGateway,
): Promise<ServiceBookingEngine | undefined> {
  return (await serviceBookingEngine(gateway)) ?? (await localFixtureEngine(gateway.mode));
}

/** Read-only engine for the shadow page (writes disabled). */
export async function shadowEngine(): Promise<
  { engine: ServiceBookingEngine; source: "apaleo" | "fixture" } | undefined
> {
  const gateway = new ServiceWriteGateway({
    mode: "disabled",
    allowedApaleoPropertyIds: [],
    store: createServiceWriteStore(getDatabase()),
    lookupReservation: () => Promise.reject(new Error("read-only")),
  });
  const live = await serviceBookingEngine(gateway);
  if (live) return { engine: live, source: "apaleo" };
  const fixture = await localFixtureEngine("disabled");
  return fixture ? { engine: fixture, source: "fixture" } : undefined;
}

export type ReservationSummary = {
  id: string;
  status: string;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  unitGroupId: string | null;
  unitId: string | null;
};

/**
 * Unified Inbox context (ADR 0023): reservation data read live from Apaleo – Apaleo stays the
 * leading source, nothing is copied. Read-only; undefined without Apaleo access or on error.
 */
export async function loadReservationSummary(
  reservationId: string,
): Promise<ReservationSummary | undefined> {
  const live = apaleoReader();
  if (!live || !/^[A-Za-z0-9_-]{1,100}$/.test(reservationId)) return undefined;
  try {
    const r = await live.getReservation(reservationId);
    return {
      id: r.id,
      status: r.status,
      arrival: r.arrival,
      departure: r.departure,
      adults: r.adults,
      children: r.childrenAges?.length ?? 0,
      unitGroupId: r.unitGroup?.id ?? null,
      unitId: r.unit?.id ?? null,
    };
  } catch (error) {
    logger.warn("inbox reservation context unavailable", {
      error: error instanceof Error ? { name: error.name } : "unknown",
    });
    return undefined;
  }
}
