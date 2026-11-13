"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { requireAdmin } from "../auth/server";
import { registerPushDevice, removePushDevice, sendTestNotification } from "./push-service";
import { pushDeps } from "./server";

export type PushActionState = { status: "idle" } | { status: "ok" | "error"; message: string };

/** Server action input is untrusted at runtime, whatever its declared type. */
function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export async function registerDeviceAction(input: {
  endpoint: unknown;
  p256dh: unknown;
  auth: unknown;
  deviceLabel: unknown;
}): Promise<PushActionState> {
  const admin = await requireAdmin();
  const userAgent = (await headers()).get("user-agent") ?? "";
  const result = await registerPushDevice(pushDeps(), admin, {
    endpoint: str(input.endpoint, 1100),
    p256dh: str(input.p256dh, 250),
    auth: str(input.auth, 150),
    deviceLabel: str(input.deviceLabel, 60),
    userAgent,
  });
  revalidatePath("/inbox/devices");
  return result.ok
    ? { status: "ok", message: result.message }
    : { status: "error", message: result.error };
}

export async function removeDeviceAction(subscriptionId: string): Promise<void> {
  const admin = await requireAdmin();
  await removePushDevice(pushDeps(), admin, subscriptionId);
  revalidatePath("/inbox/devices");
}

export async function testPushAction(
  subscriptionId: string,
  _previous: PushActionState,
): Promise<PushActionState> {
  const admin = await requireAdmin();
  const result = await sendTestNotification(pushDeps(), admin, subscriptionId);
  revalidatePath("/inbox/devices");
  return result.ok
    ? { status: "ok", message: result.message }
    : { status: "error", message: result.error };
}
