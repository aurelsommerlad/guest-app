import "server-only";

import { type AccessProvider, parseAccessCodeKey } from "@up/core";
import { getUnitAccessCode } from "@up/db";
import { KeyboxAccessProvider } from "@up/integrations";
import { cache } from "react";

import { serverEnv } from "../../env/server";
import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { type GuestContext } from "../guest-context/guest-context";
import { loadStayJourney, type StayJourney } from "./stay-journey";

let keybox: AccessProvider | undefined;

/** Key box provider – only with a database and ACCESS_CODE_KEY (else manual access). */
function accessProvider(): AccessProvider | undefined {
  const db = getDatabase();
  if (!db || !serverEnv.ACCESS_CODE_KEY) return undefined;
  keybox ??= new KeyboxAccessProvider({
    key: parseAccessCodeKey(serverEnv.ACCESS_CODE_KEY),
    logger,
    loadCiphertext: async ({ tenantId, propertyId, unitId }) =>
      (await getUnitAccessCode(db, { tenantId }, { propertyId, unitId }))?.codeCiphertext,
  });
  return keybox;
}

export function journeyDeps() {
  return { db: getDatabase(), logger, accessProvider: accessProvider() };
}

/** The current stay's journey, once per request. The access code is never included here. */
export const getStayJourney = cache((context: GuestContext): Promise<StayJourney | undefined> =>
  loadStayJourney(journeyDeps(), context),
);
