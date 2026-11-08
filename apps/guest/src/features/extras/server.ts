import "server-only";

import {
  createServiceLockStore,
  createServiceRecordStore,
  createServiceWriteStore,
  type Database,
} from "@up/db";
import {
  ApaleoClient,
  ApaleoServiceReader,
  ServiceBookingEngine,
  ServiceWriteGateway,
  type ServiceWriteRequest,
} from "@up/integrations";

import { findPropertyByPmsId } from "../../config/properties";
import { STAY_ENGINE_APALEO_PROPERTIES, stayEngineEnabled } from "../../config/upsell";
import { serverEnv } from "../../env/server";
import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { type BridgeSubject, createExtrasBridge, type ExtrasBridge } from "./bridge-client";
import { createEngineBridge } from "./engine-bridge";

let bridge: ExtrasBridge | undefined;
let reader: ApaleoServiceReader | undefined;

/** The Extras bridge client, or undefined while EXTRAS_BRIDGE_URL / _SECRET are not set. */
function extrasBridge(): ExtrasBridge | undefined {
  const url = serverEnv.EXTRAS_BRIDGE_URL;
  const secret = serverEnv.EXTRAS_BRIDGE_SECRET;
  if (!url || !secret) return undefined;
  bridge ??= createExtrasBridge({
    baseUrl: url,
    secret,
    ...(serverEnv.EXTRAS_BRIDGE_PROTECTION_BYPASS
      ? { protectionBypass: serverEnv.EXTRAS_BRIDGE_PROTECTION_BYPASS }
      : {}),
    onError: (route, detail) => {
      logger.warn("extras bridge unavailable", { route, ...detail });
    },
  });
  return bridge;
}

function serviceReader(): ApaleoServiceReader | undefined {
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

/**
 * Local development only: with APALEO_SIM_STATE (guest-services Apaleo simulator) simulated
 * commands are applied to the simulator state, so "Gebucht & angefragt" shows the result.
 */
async function localSimulatorHook(): Promise<((request: ServiceWriteRequest) => void) | undefined> {
  if (serverEnv.APP_ENV !== "local" || !process.env.APALEO_SIM_STATE) return undefined;
  const { applyToSimulator } = await import("@up/shadow/simulator-state");
  return applyToSimulator;
}

/** The STAY engine for a subject the feature switch allows (TEST only), else undefined. */
async function engineFor(db: Database, subject: BridgeSubject) {
  const property = findPropertyByPmsId("apaleo", subject.apaleoPropertyId);
  if (!property || !stayEngineEnabled(property, serverEnv.GUEST_SERVICE_ENGINE)) return undefined;
  const apaleo = serviceReader();
  if (!apaleo) return undefined;
  const onSimulated = await localSimulatorHook();
  const gateway = new ServiceWriteGateway({
    mode: serverEnv.APALEO_SERVICE_WRITES,
    allowedApaleoPropertyIds: STAY_ENGINE_APALEO_PROPERTIES,
    store: createServiceWriteStore(db),
    lookupReservation: async (id) => {
      const reservation = await apaleo.getReservation(id);
      return { property: reservation.property, status: reservation.status };
    },
    ...(onSimulated ? { onSimulated } : {}),
  });
  return {
    propertyId: property.id,
    engine: new ServiceBookingEngine({
      reader: apaleo,
      gateway,
      records: createServiceRecordStore(db),
      locks: createServiceLockStore(db),
      verifySimulatedWrites: onSimulated ? "check" : "skip",
    }),
  };
}

/** True when this subject is served by the STAY engine (feature switch, TEST only). */
export function servedByStayEngine(subject: BridgeSubject): boolean {
  const property = findPropertyByPmsId("apaleo", subject.apaleoPropertyId);
  return Boolean(property && stayEngineEnabled(property, serverEnv.GUEST_SERVICE_ENGINE));
}

/**
 * The guest app's service backend: per subject either the own STAY engine (only where the M4
 * feature switch allows it – TEST) or the unchanged Extras bridge (every other property).
 * Undefined when neither is available.
 */
export function getExtrasBridge(): ExtrasBridge | undefined {
  const extras = extrasBridge();
  const db = getDatabase();
  const engineAvailable = serverEnv.GUEST_SERVICE_ENGINE === "test" && db && serviceReader();
  if (!engineAvailable) return extras;
  const engine = createEngineBridge({ db, engineFor: (subject) => engineFor(db, subject) });
  const unavailable = () => Promise.resolve({ kind: "unavailable" as const });
  const route = (subject: BridgeSubject) => (servedByStayEngine(subject) ? engine : extras);
  return {
    catalog: (subject) => route(subject)?.catalog(subject) ?? unavailable(),
    overview: (subject) => route(subject)?.overview(subject) ?? unavailable(),
    order: (subject, input) => route(subject)?.order(subject, input) ?? unavailable(),
    request: (subject, input) => route(subject)?.request(subject, input) ?? unavailable(),
    extend: (subject, input) => route(subject)?.extend(subject, input) ?? unavailable(),
  };
}
