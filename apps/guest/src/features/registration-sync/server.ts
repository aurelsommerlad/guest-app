import "server-only";

import { type GuestRegistrationProvider, type RegistrationTarget } from "@up/core";
import {
  ApaleoClient,
  ApaleoRegistrationWriteBack,
  FeratelRegistrationProvider,
} from "@up/integrations";

import { serverEnv } from "../../env/server";
import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { processRegistrationSyncs, type SyncRunSummary } from "./process-registration-syncs";

let writeBack: ApaleoRegistrationWriteBack | undefined;

/**
 * Targets that may actually be called in this environment:
 * - apaleo: only with APALEO_REGISTRATION_WRITEBACK=enabled and credentials
 * - feratel: never until the interface is verified (FeratelRegistrationProvider.implemented)
 */
export function registrationProviders(): Partial<
  Record<RegistrationTarget, GuestRegistrationProvider>
> {
  const providers: Partial<Record<RegistrationTarget, GuestRegistrationProvider>> = {};
  if (
    serverEnv.APALEO_REGISTRATION_WRITEBACK === "enabled" &&
    serverEnv.APALEO_CLIENT_ID &&
    serverEnv.APALEO_CLIENT_SECRET
  ) {
    writeBack ??= new ApaleoRegistrationWriteBack(
      new ApaleoClient({
        clientId: serverEnv.APALEO_CLIENT_ID,
        clientSecret: serverEnv.APALEO_CLIENT_SECRET,
        logger,
      }),
      logger,
    );
    providers.apaleo = writeBack;
  }
  if (FeratelRegistrationProvider.implemented)
    providers.feratel = new FeratelRegistrationProvider();
  return providers;
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
