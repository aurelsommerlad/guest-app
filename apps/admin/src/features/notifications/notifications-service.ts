/**
 * Slack notifications in the admin (M4): outbox with status, attempts and error codes (error
 * log), Slack route and decision updates per property, and a manual worker run. Delivery is
 * simulated only – no webhook is ever called from STAY in M4.
 */
import {
  claimDueNotifications,
  completeNotification,
  type Database,
  getSlackSettings,
  listNotifications,
  listPropertiesForTenant,
  NOTIFICATION_BACKOFF_MINUTES,
  type OutboxJob,
  saveSlackSettings,
} from "@up/db";
import {
  createSimulatedSlackTransport,
  renderSlackMessage,
  runNotificationWorker,
  type SlackDeliveryMode,
  type WorkerRun,
} from "@up/integrations";

import { type AdminContext } from "../auth/admin-auth-service";
import { FORBIDDEN_MESSAGE, isAllowed, visibleProperties } from "../auth/authorization";

export type NotificationsDeps = {
  db: Database;
  mode: SlackDeliveryMode;
  adminBaseUrl: string;
  now: () => Date;
};

const ctx = (admin: AdminContext) => ({ tenantId: admin.tenantId });

export async function loadNotifications(deps: NotificationsDeps, admin: AdminContext) {
  if (!isAllowed(admin, "settings.read")) return { ok: false as const, error: FORBIDDEN_MESSAGE };
  const properties = visibleProperties(admin, await listPropertiesForTenant(deps.db, ctx(admin)));
  const ids = properties.map((p) => p.id);
  const restricted = admin.propertyScope !== "all";
  const [jobs, settings] = await Promise.all([
    listNotifications(deps.db, ctx(admin), restricted ? { propertyIds: ids } : {}),
    Promise.all(
      properties.map(async (p) => ({
        property: p,
        ...(await getSlackSettings(deps.db, ctx(admin), p.id)),
      })),
    ),
  ]);
  const nameOf = (id: string | null) =>
    properties.find((p) => p.id === id)?.displayName ?? id ?? "–";
  return {
    ok: true as const,
    mode: deps.mode,
    canRun: deps.mode !== "off" && isAllowed(admin, "settings.edit"),
    settings: settings.map((s) => ({
      ...s,
      canEdit: isAllowed(admin, "settings.edit", { propertyId: s.property.id }),
    })),
    jobs: jobs.map((job: OutboxJob) => ({
      ...job,
      propertyName: nameOf(job.propertyId),
      preview:
        renderSlackMessage(job.template, job.payload, {
          propertyName: nameOf(job.propertyId),
          adminBaseUrl: deps.adminBaseUrl,
        })?.text ?? null,
    })),
  };
}

export async function saveSlackRoute(
  deps: NotificationsDeps,
  admin: AdminContext,
  propertyId: string,
  form: { route: string; decisionUpdates: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isAllowed(admin, "settings.edit", { propertyId }))
    return { ok: false, error: FORBIDDEN_MESSAGE };
  const route = form.route.trim().toLowerCase();
  const result = await saveSlackSettings(deps.db, ctx(admin), {
    propertyId,
    slackRoute: route ? route : null,
    slackDecisionUpdates: form.decisionUpdates,
    actorAdminId: admin.adminUserId,
    now: deps.now(),
  });
  return result.ok
    ? { ok: true }
    : {
        ok: false,
        error:
          "Ziel bitte als Kurzname aus Kleinbuchstaben, Ziffern und Bindestrichen (z. B. front-office-test).",
      };
}

/** One worker run with the simulated transport (owners/admins with all properties). */
export async function runNotificationQueue(
  deps: NotificationsDeps,
  admin: AdminContext,
): Promise<{ ok: true; run: WorkerRun } | { ok: false; error: string }> {
  if (!isAllowed(admin, "settings.edit")) return { ok: false, error: FORBIDDEN_MESSAGE };
  if (deps.mode === "off")
    return { ok: false, error: "Slack-Benachrichtigungen sind in dieser Umgebung ausgeschaltet." };
  const run = await runNotificationWorker({
    mode: deps.mode,
    transport: createSimulatedSlackTransport(),
    claim: (input) => claimDueNotifications(deps.db, input),
    complete: (input) => completeNotification(deps.db, input),
    settingsOf: async (tenantId, propertyId) => {
      const properties = await listPropertiesForTenant(deps.db, { tenantId });
      return {
        ...(await getSlackSettings(deps.db, { tenantId }, propertyId)),
        propertyName: properties.find((p) => p.id === propertyId)?.displayName ?? propertyId,
      };
    },
    adminBaseUrl: deps.adminBaseUrl,
    backoffMinutes: NOTIFICATION_BACKOFF_MINUTES,
    now: deps.now,
  });
  return { ok: true, run };
}
