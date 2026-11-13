/**
 * Push devices of staff members (ADR 0023, I3). Only the caller's own devices are visible
 * (RLS). A test notification goes only to one of the caller's own, explicitly registered
 * devices and only with PUSH_DELIVERY=test – there are no automatic notifications yet.
 */
import { randomUUID } from "node:crypto";

import { isValidPushEndpoint, type PushPayload, type PushSender } from "@up/core";
import {
  type Database,
  getOwnPushKeys,
  listConversations,
  recordPushDelivery,
  revokePushSubscription,
  savePushSubscription,
} from "@up/db";

import { type AdminContext } from "../auth/admin-auth-service";
import { inboxScopeFor } from "./inbox-service";

export type PushDeps = {
  db: Database;
  mode: "off" | "test";
  /** Undefined when no VAPID keys are configured. */
  sender?: PushSender;
  now: () => Date;
};

export type PushResult = { ok: true; message: string } | { ok: false; error: string };

const KEY = /^[A-Za-z0-9_=-]{8,200}$/;

export async function registerPushDevice(
  deps: PushDeps,
  admin: AdminContext,
  input: { endpoint: string; p256dh: string; auth: string; deviceLabel: string; userAgent: string },
): Promise<PushResult> {
  const scope = inboxScopeFor(admin);
  if (!scope) return { ok: false, error: "Dafür fehlt Dir die Berechtigung." };
  if (!isValidPushEndpoint(input.endpoint) || !KEY.test(input.p256dh) || !KEY.test(input.auth))
    return { ok: false, error: "Dieses Gerät hat keine gültige Push-Anmeldung geliefert." };
  const label = input.deviceLabel.trim().slice(0, 60);
  await savePushSubscription(deps.db, scope, {
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    ...(label ? { deviceLabel: label } : {}),
    userAgentFamily: userAgentFamily(input.userAgent),
  });
  return { ok: true, message: "Gerät registriert." };
}

export async function removePushDevice(
  deps: PushDeps,
  admin: AdminContext,
  subscriptionId: string,
): Promise<PushResult> {
  const scope = inboxScopeFor(admin);
  if (!scope) return { ok: false, error: "Dafür fehlt Dir die Berechtigung." };
  const done = await revokePushSubscription(deps.db, scope, {
    subscriptionId,
    reason: "user",
    now: deps.now(),
  });
  return done
    ? { ok: true, message: "Gerät entfernt." }
    : { ok: false, error: "Gerät nicht gefunden." };
}

/** Test notification to one of the caller's own devices, deep-linking a visible conversation. */
export async function sendTestNotification(
  deps: PushDeps,
  admin: AdminContext,
  subscriptionId: string,
): Promise<PushResult> {
  const scope = inboxScopeFor(admin);
  if (!scope) return { ok: false, error: "Dafür fehlt Dir die Berechtigung." };
  if (deps.mode !== "test" || !deps.sender)
    return { ok: false, error: "Push ist auf diesem System nicht eingeschaltet (PUSH_DELIVERY)." };
  const keys = await getOwnPushKeys(deps.db, scope, subscriptionId);
  if (!keys) return { ok: false, error: "Gerät nicht gefunden oder entfernt." };
  const [latest] = await listConversations(deps.db, scope, { limit: 1 });
  const payload: PushPayload = {
    title: "STAY Test-Mitteilung",
    body: "So sehen Mitteilungen aus – ohne Nachrichteninhalt. Tippen öffnet die Unterhaltung.",
    url: latest ? `/inbox/c/${latest.id}` : "/inbox",
    tag: "stay-test",
  };
  const result = await deps.sender.send(keys, payload);
  await recordPushDelivery(deps.db, scope, {
    subscriptionId,
    adminUserId: admin.adminUserId,
    kind: "test",
    dedupKey: `test:${randomUUID()}`,
    ...(latest ? { conversationId: latest.id } : {}),
    status: result.status === "sent" ? "sent" : result.status === "expired" ? "expired" : "failed",
    ...(result.status !== "failed" || result.httpStatus ? { httpStatus: result.httpStatus } : {}),
    ...(result.status === "failed" ? { errorCode: result.code } : {}),
    now: deps.now(),
  });
  if (result.status === "sent")
    return { ok: true, message: "Test-Mitteilung an den Push-Dienst übergeben." };
  if (result.status === "expired")
    return { ok: false, error: "Das Gerät ist nicht mehr angemeldet und wurde entfernt." };
  return { ok: false, error: `Zustellung fehlgeschlagen (${result.code}).` };
}

/** Coarse device family for the device list – never the full user agent. */
export function userAgentFamily(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  const os = /iphone|ipad/.test(ua)
    ? "iOS"
    : ua.includes("android")
      ? "Android"
      : ua.includes("mac os")
        ? "macOS"
        : ua.includes("windows")
          ? "Windows"
          : "Gerät";
  const browser = ua.includes("edg/")
    ? "Edge"
    : ua.includes("firefox")
      ? "Firefox"
      : ua.includes("chrome") || ua.includes("crios")
        ? "Chrome"
        : ua.includes("safari")
          ? "Safari"
          : "Browser";
  return `${os} · ${browser}`;
}
