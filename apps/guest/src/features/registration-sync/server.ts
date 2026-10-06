import "server-only";

import { type GuestRegistrationProvider, type RegistrationTarget } from "@up/core";
import { ApaleoClient, ApaleoRegistrationWriteBack } from "@up/integrations";

import { serverEnv } from "../../env/server";
import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { processRegistrationSyncs, type SyncRunSummary } from "./process-registration-syncs";
import { selectRegistrationProviders } from "./select-providers";

let writeBack: ApaleoRegistrationWriteBack | undefined;

export function registrationProviders(): Partial<
  Record<RegistrationTarget, GuestRegistrationProvider>
> {
  return selectRegistrationProviders(serverEnv, {
    apaleo: () =>
      (writeBack ??= new ApaleoRegistrationWriteBack(
        new ApaleoClient({
          clientId: serverEnv.APALEO_CLIENT_ID ?? "",
          clientSecret: serverEnv.APALEO_CLIENT_SECRET ?? "",
          logger,
        }),
        logger,
      )),
  });
}

/** One sync run; never throws (the guest flow and the cron call must not fail on it). */
export async function runRegistrationSync(limit = 20): Promise<SyncRunSummary | undefined> {
  const db = getDatabase();
  if (!db) return undefined;
  try {
    return await processRegistrationSyncs(
      { db, logger, now: () => new Date(), providers: registrationProviders() },
      { limit },
    );
  } catch (error) {
    logger.error("registration sync run failed", {
      error: error instanceof Error ? { name: error.name } : "unknown",
    });
    return undefined;
  }
}
