/**
 * Slack notifications of STAY (M4): message rendering and the outbox worker. Until Slack is
 * approved only the simulated transport exists – no webhook is called. Messages carry service,
 * property, dates, amount, reservation id and a link into the STAY admin; never guest names,
 * e-mail addresses or free texts (the outbox payload rules forbid them).
 */
export const SLACK_DELIVERY_MODES = ["off", "simulated"] as const;
export type SlackDeliveryMode = (typeof SLACK_DELIVERY_MODES)[number];

export type SlackMessage = { text: string; blocks: unknown[] };

type Payload = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const eur = (cents: number | null, currency = "EUR") =>
  cents === null
    ? "–"
    : new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(cents / 100);
const day = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "UTC" }).format(
        new Date(`${d}T00:00:00Z`),
      )
    : d;

/** Rendered Slack message for a template, or null when the template is not a Slack message. */
export function renderSlackMessage(
  template: string,
  payload: Payload,
  context: { propertyName: string; adminBaseUrl: string },
): SlackMessage | null {
  const title = str(payload.serviceTitle) || str(payload.serviceId) || "Service";
  const quantity = num(payload.quantity) ?? 1;
  const requestUrl = str(payload.requestId)
    ? `${context.adminBaseUrl.replace(/\/+$/, "")}/requests/r/${encodeURIComponent(str(payload.requestId))}`
    : null;
  const button = requestUrl
    ? [
        {
          type: "actions",
          elements: [
            { type: "button", text: { type: "plain_text", text: "Anfrage bearbeiten" }, url: requestUrl },
          ],
        },
      ]
    : [];
  const section = (text: string) => ({ type: "section", text: { type: "mrkdwn", text } });
  if (template === "service.request") {
    const dates = Array.isArray(payload.dates) ? payload.dates.map((d) => day(str(d))).join(", ") : "";
    const total = num(payload.quotedCents);
    const lines = [
      `*Neue Anfrage:* ${quantity}× ${title}`,
      `*Objekt:* ${context.propertyName}`,
      ...(str(payload.reservationId) ? [`*Reservierung:* ${str(payload.reservationId)}`] : []),
      ...(dates ? [`*Datum:* ${dates}`] : []),
      `*Angezeigter Preis:* ${eur(total === null ? null : total * quantity, str(payload.currency) || "EUR")}`,
    ];
    return { text: `Neue Anfrage: ${quantity}× ${title} – ${context.propertyName}`, blocks: [section(lines.join("\n")), ...button] };
  }
  if (template === "service.request_confirmed" || template === "service.request_declined") {
    const verb = template === "service.request_confirmed" ? "bestätigt" : "abgelehnt";
    const text = `Anfrage ${verb}: ${quantity}× ${title} – ${context.propertyName}`;
    return { text, blocks: [section(`*Anfrage ${verb}:* ${quantity}× ${title}\n*Objekt:* ${context.propertyName}`), ...button] };
  }
  return null;
}

export type SlackTransport = (input: {
  route: string;
  message: SlackMessage;
  idempotencyKey: string;
}) => Promise<{ ok: true } | { ok: false; code: string; retryable: boolean }>;

/** The only transport in M4: records what would be posted, sends nothing. */
export function createSimulatedSlackTransport(
  sink: (entry: { route: string; text: string; idempotencyKey: string }) => void = () => undefined,
): SlackTransport {
  return ({ route, message, idempotencyKey }) => {
    sink({ route, text: message.text, idempotencyKey });
    return Promise.resolve({ ok: true });
  };
}

type Job = {
  id: string;
  tenantId: string;
  propertyId: string | null;
  template: string;
  dedupKey: string;
  payload: Payload;
  attempts: number;
};

export type NotificationWorkerDeps = {
  mode: SlackDeliveryMode;
  transport: SlackTransport;
  claim: (input: { now: Date; limit: number }) => Promise<Job[]>;
  complete: (
    input:
      | { id: string; outcome: "sent"; deliveryMode: "simulated" | "live"; now: Date }
      | { id: string; outcome: "suppressed"; reason: string; now: Date }
      | { id: string; outcome: "failed"; errorCode: string; retryAt: Date | null; now: Date },
  ) => Promise<void>;
  settingsOf: (
    tenantId: string,
    propertyId: string,
  ) => Promise<{ slackRoute: string | null; slackDecisionUpdates: boolean; propertyName: string }>;
  adminBaseUrl: string;
  backoffMinutes: readonly number[];
  now?: () => Date;
};

export type WorkerRun = { claimed: number; sent: number; suppressed: number; retried: number; failed: number };

/**
 * One worker run: claims due jobs, renders, posts (simulated) and records the result. A job is
 * claimed by exactly one worker and has one dedup key per event, so a message is not posted
 * twice; a crash between posting and recording can at most repeat one message (at-least-once).
 */
export async function runNotificationWorker(
  deps: NotificationWorkerDeps,
  limit = 20,
): Promise<WorkerRun> {
  const run: WorkerRun = { claimed: 0, sent: 0, suppressed: 0, retried: 0, failed: 0 };
  if (deps.mode === "off") return run;
  const now = deps.now ?? (() => new Date());
  const jobs = await deps.claim({ now: now(), limit });
  run.claimed = jobs.length;
  for (const job of jobs) {
    const fail = async (code: string, retryable: boolean) => {
      const delay = deps.backoffMinutes[job.attempts - 1];
      const retryAt = retryable && delay !== undefined ? new Date(now().getTime() + delay * 60_000) : null;
      await deps.complete({ id: job.id, outcome: "failed", errorCode: code, retryAt, now: now() });
      if (retryAt) run.retried += 1;
      else run.failed += 1;
    };
    try {
      if (!job.propertyId) {
        await fail("no_property", false);
        continue;
      }
      const settings = await deps.settingsOf(job.tenantId, job.propertyId);
      const isDecision = job.template === "service.request_confirmed" || job.template === "service.request_declined";
      if (job.template === "service.order" || (isDecision && !settings.slackDecisionUpdates)) {
        // Extras posts no message for instant bookings; decision updates are opt-in per property.
        await deps.complete({ id: job.id, outcome: "suppressed", reason: isDecision ? "decision_updates_off" : "not_a_slack_message", now: now() });
        run.suppressed += 1;
        continue;
      }
      const message = renderSlackMessage(job.template, job.payload, {
        propertyName: settings.propertyName,
        adminBaseUrl: deps.adminBaseUrl,
      });
      if (!message) {
        await deps.complete({ id: job.id, outcome: "suppressed", reason: "unknown_template", now: now() });
        run.suppressed += 1;
        continue;
      }
      if (!settings.slackRoute) {
        await fail("no_slack_route", false);
        continue;
      }
      const result = await deps.transport({ route: settings.slackRoute, message, idempotencyKey: job.dedupKey });
      if (result.ok) {
        await deps.complete({ id: job.id, outcome: "sent", deliveryMode: "simulated", now: now() });
        run.sent += 1;
      } else {
        await fail(result.code, result.retryable);
      }
    } catch {
      await fail("worker_error", true);
    }
  }
  return run;
}
