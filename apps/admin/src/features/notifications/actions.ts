"use server";

import { redirect } from "next/navigation";

import { requireAdmin } from "../auth/server";
import { runNotificationQueue, saveSlackRoute } from "./notifications-service";
import { notificationsDeps } from "./server";

const back = (key: "notice" | "error", text: string): never =>
  redirect(`/notifications?${key}=${encodeURIComponent(text)}`);

export async function saveSlackRouteAction(propertyId: string, formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const route = formData.get("route");
  const result = await saveSlackRoute(notificationsDeps(), admin, propertyId, {
    route: typeof route === "string" ? route.slice(0, 60) : "",
    decisionUpdates: formData.get("decisionUpdates") === "on",
  });
  if (result.ok) back("notice", "Gespeichert.");
  else back("error", result.error);
}

export async function runNotificationQueueAction(): Promise<void> {
  const admin = await requireAdmin();
  const result = await runNotificationQueue(notificationsDeps(), admin);
  if (!result.ok) back("error", result.error);
  else {
    const r = result.run;
    back(
      "notice",
      `Warteschlange verarbeitet (simuliert): ${String(r.sent)} gesendet, ${String(r.suppressed)} unterdrückt, ${String(r.retried)} später erneut, ${String(r.failed)} fehlgeschlagen.`,
    );
  }
}
