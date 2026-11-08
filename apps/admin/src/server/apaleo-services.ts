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
export function serviceBookingEngine(gateway: ServiceWriteGateway): ServiceBookingEngine | undefined {
  const live = apaleoReader();
  if (!live) return undefined;
  const db = getDatabase();
  return new ServiceBookingEngine({
    reader: live,
    gateway,
    records: createServiceRecordStore(db),
    locks: createServiceLockStore(db),
  });
}
