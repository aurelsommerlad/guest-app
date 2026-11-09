/**
 * M4: Slack notifications through the outbox – simulated delivery only. Route per property,
 * retry with backoff, idempotency (one job per event, one claim per job), error log.
 */
import {
  claimDueNotifications,
  completeNotification,
  getSlackSettings,
  NOTIFICATION_BACKOFF_MINUTES,
  saveSlackSettings,
} from "@up/db";
import {
  createSimulatedSlackTransport,
  runNotificationWorker,
  type SlackTransport,
} from "@up/integrations";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createShadowEnv, CONTEXT, type ShadowEnv } from "./test-env";

let env: ShadowEnv;
let clock = new Date("2027-01-05T10:00:00Z");
const posted: { route: string; text: string; idempotencyKey: string }[] = [];

function worker(transport: SlackTransport = createSimulatedSlackTransport((e) => posted.push(e))) {
  return runNotificationWorker({
    mode: "simulated",
    transport,
    claim: (input) => claimDueNotifications(env.db, input),
    complete: (input) => completeNotification(env.db, input),
    settingsOf: async (tenantId, propertyId) => ({
      ...(await getSlackSettings(env.db, { tenantId }, propertyId)),
      propertyName: "TEST",
    }),
    adminBaseUrl: "https://admin.example.test",
    backoffMinutes: NOTIFICATION_BACKOFF_MINUTES,
    now: () => clock,
  });
}

async function newRequest() {
  const id = `SLACK${String(Math.floor(Math.random() * 1e6))}-1`;
  env.reset({ reservationId: id });
  const created = await env
    .engine()
    .createRequest(CONTEXT, { reservationId: id, serviceId: "TEST-BABY", quantity: 1 });
  if (!created.ok) throw new Error(created.reason);
  return { id, requestId: created.requestId };
}

beforeAll(async () => {
  env = await createShadowEnv();
  // The other suites' jobs are not part of this test.
  await env.test.client.query(`DELETE FROM notification_outbox`);
});
afterAll(async () => {
  await env.test.client.query("SELECT 1");
  await env.test.close();
});

describe("Slack (simulated)", () => {
  it("fails without a route (error log), posts once the property has a route", async () => {
    await env.test.client.query(
      `UPDATE property_service_settings SET slack_route = NULL WHERE property_id = 'test-run'`,
    );
    await newRequest();
    const firstRun = await worker();
    expect(firstRun).toMatchObject({ claimed: 1, failed: 1 });
    const audit = await env.test.client.query<{ details: Record<string, unknown> }>(
      `SELECT details FROM admin_audit_events WHERE action = 'notification.failed'`,
    );
    expect(audit.rows[0]?.details).toMatchObject({
      code: "no_slack_route",
      kind: "service.request",
    });

    await saveSlackSettings(
      env.db,
      { tenantId: CONTEXT.tenantId },
      {
        propertyId: "test-run",
        slackRoute: "front-office-test",
        slackDecisionUpdates: false,
        actorAdminId: env.ownerId,
        now: clock,
      },
    );
    const second = await newRequest();
    expect(await worker()).toMatchObject({ claimed: 1, sent: 1 });
    expect(posted.at(-1)).toMatchObject({
      route: "front-office-test",
      idempotencyKey: `service-request:${second.requestId}`,
    });
    expect(posted.at(-1)?.text).toBe("Neue Anfrage: 1× Babybett – TEST");
    const row = await env.test.client.query<{ status: string; delivery_mode: string }>(
      `SELECT status, delivery_mode FROM notification_outbox WHERE dedup_key = $1`,
      [`service-request:${second.requestId}`],
    );
    expect(row.rows[0]).toEqual({ status: "sent", delivery_mode: "simulated" });
    // Nothing is posted twice: a second run finds no due job.
    expect(await worker()).toMatchObject({ claimed: 0 });
  });

  it("retries with backoff on transport errors and gives up after the last attempt", async () => {
    await newRequest();
    const failing: SlackTransport = () =>
      Promise.resolve({ ok: false, code: "slack_unavailable", retryable: true });
    for (let attempt = 1; attempt <= NOTIFICATION_BACKOFF_MINUTES.length; attempt++) {
      const run = await worker(failing);
      expect(run.claimed).toBe(1);
      expect(await worker(failing)).toMatchObject({ claimed: 0 }); // not due yet
      clock = new Date(
        clock.getTime() + (NOTIFICATION_BACKOFF_MINUTES[attempt - 1] ?? 0) * 60_000 + 1000,
      );
    }
    expect(await worker(failing)).toMatchObject({ claimed: 1, failed: 1 });
    const row = await env.test.client.query<{
      status: string;
      attempts: number;
      last_error_code: string;
    }>(
      `SELECT status, attempts, last_error_code FROM notification_outbox ORDER BY created_at DESC LIMIT 1`,
    );
    expect(row.rows[0]).toEqual({
      status: "failed",
      attempts: 6,
      last_error_code: "slack_unavailable",
    });
  });

  it("decision messages only when enabled for the property; parallel workers never double-post", async () => {
    const { requestId } = await newRequest();
    await worker();
    await env.engine().rejectRequest(CONTEXT, requestId, env.ownerId);
    expect(await worker()).toMatchObject({ claimed: 1, suppressed: 1 });
    await saveSlackSettings(
      env.db,
      { tenantId: CONTEXT.tenantId },
      {
        propertyId: "test-run",
        slackRoute: "front-office-test",
        slackDecisionUpdates: true,
        actorAdminId: env.ownerId,
        now: clock,
      },
    );
    const next = await newRequest();
    await worker();
    expect(await env.engine().approveRequest(CONTEXT, next.requestId, env.ownerId)).toMatchObject({
      ok: true,
    });
    const before = posted.length;
    const runs = await Promise.all([worker(), worker(), worker()]);
    expect(runs.reduce((sum, r) => sum + r.sent, 0)).toBe(1);
    expect(posted.length - before).toBe(1);
    expect(posted.at(-1)?.text).toBe("Anfrage bestätigt: 1× Babybett – TEST");
  });
});
