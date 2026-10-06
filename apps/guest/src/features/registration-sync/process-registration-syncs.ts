/**
 * Registration sync worker (ADR 0016): claims due sync rows, hands the canonical data to
 * the target's GuestRegistrationProvider and records the outcome with backoff.
 *
 * - Runs after a submit (in the background) and periodically via the cron endpoint.
 * - Only providers that are configured *and* implemented are passed in; syncs of other
 *   targets (e.g. Feratel today) stay "pending" – visible, never lost.
 * - A provider failure never touches the canonical registration.
 * - Logs ids and codes only.
 */
import {
  type GuestRegistrationProvider,
  type Logger,
  nextSyncState,
  type RegistrationSubmission,
  type RegistrationTarget,
  SYNC_LEASE_MS,
  type SyncOutcome,
} from "@up/core";
import {
  claimDueSyncs,
  completeSyncAttempt,
  type Database,
  getJourneySettings,
  getRegistrationById,
  type RegistrationSyncRecord,
} from "@up/db";

export type RegistrationSyncDeps = {
  db: Database;
  logger: Logger;
  now: () => Date;
  providers: Partial<Record<RegistrationTarget, GuestRegistrationProvider>>;
};

export type SyncRunSummary = { claimed: number; synced: number; retry: number; failed: number };

async function attempt(
  deps: RegistrationSyncDeps,
  sync: RegistrationSyncRecord,
  provider: GuestRegistrationProvider,
): Promise<SyncOutcome> {
  const context = { tenantId: sync.tenantId };
  const registration = await getRegistrationById(deps.db, context, sync.registrationId);
  if (!registration || registration.status !== "submitted" || registration.purgedAt) {
    return { status: "failed", code: "invalid_data" };
  }
  const settings = await getJourneySettings(deps.db, context, registration.propertyId);
  const submission: RegistrationSubmission = {
    registrationId: registration.id,
    tenantId: registration.tenantId,
    propertyId: registration.propertyId,
    reservation: {
      provider: registration.reservationProvider,
      externalReservationId: registration.externalReservationId,
    },
    arrivalAt: registration.arrivalAt.toISOString(),
    departureAt: registration.departureAt.toISOString(),
    guests: registration.guests,
    settings: settings.registration.providerSettings[sync.provider] ?? {},
  };
  return provider.submit(submission, {
    ...(sync.externalReference ? { externalReference: sync.externalReference } : {}),
    ...(sync.fingerprint ? { fingerprint: sync.fingerprint } : {}),
  });
}

export async function processRegistrationSyncs(
  deps: RegistrationSyncDeps,
  options: { limit?: number } = {},
): Promise<SyncRunSummary> {
  const providers = Object.keys(deps.providers) as RegistrationTarget[];
  const summary: SyncRunSummary = { claimed: 0, synced: 0, retry: 0, failed: 0 };
  if (providers.length === 0) return summary;
  const claimed = await claimDueSyncs(deps.db, {
    now: deps.now(),
    providers,
    limit: options.limit ?? 20,
    leaseMs: SYNC_LEASE_MS,
  });
  summary.claimed = claimed.length;
  for (const sync of claimed) {
    const provider = deps.providers[sync.provider];
    let outcome: SyncOutcome;
    try {
      outcome = provider
        ? await attempt(deps, sync, provider)
        : { status: "failed", code: "not_configured" };
    } catch (error) {
      // Unexpected error (database, bug): retry later, keep the data.
      deps.logger.error("registration sync attempt crashed", {
        syncId: sync.id,
        error: error instanceof Error ? { name: error.name } : "unknown",
      });
      outcome = { status: "retry", code: "unknown" };
    }
    const now = deps.now();
    const next = nextSyncState(outcome, sync.attempts, now);
    await completeSyncAttempt(deps.db, { tenantId: sync.tenantId }, sync.id, {
      status:
        next.status === "synced"
          ? "synced"
          : next.status === "failed"
            ? "failed"
            : "retry_required",
      now,
      ...(next.nextAttemptAt ? { nextAttemptAt: next.nextAttemptAt } : {}),
      ...(next.errorCode ? { errorCode: next.errorCode } : {}),
      ...(outcome.status === "synced" && outcome.externalReference
        ? { externalReference: outcome.externalReference }
        : {}),
      ...(outcome.status === "synced" && outcome.fingerprint
        ? { fingerprint: outcome.fingerprint }
        : {}),
    });
    if (next.status === "synced") summary.synced += 1;
    else if (next.status === "failed") summary.failed += 1;
    else summary.retry += 1;
    deps.logger.info("registration sync attempt", {
      syncId: sync.id,
      registrationId: sync.registrationId,
      provider: sync.provider,
      attempt: sync.attempts,
      status: next.status,
      ...(next.errorCode ? { code: next.errorCode } : {}),
    });
  }
  return summary;
}
