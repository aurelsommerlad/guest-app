import "server-only";

import { WebPushSender } from "@up/integrations";

import { serverEnv } from "../../env/server";
import { getDatabase } from "../../server/database";
import { type InboxDeps } from "./inbox-service";
import { type PushDeps } from "./push-service";

export function inboxDeps(): InboxDeps {
  return {
    db: getDatabase(),
    simulation: serverEnv.APP_ENV !== "production" && serverEnv.INBOX_SIMULATION === "on",
    now: () => new Date(),
  };
}

let sender: WebPushSender | undefined;

export function pushDeps(): PushDeps {
  const vapid =
    serverEnv.VAPID_PUBLIC_KEY && serverEnv.VAPID_PRIVATE_KEY && serverEnv.VAPID_SUBJECT
      ? {
          publicKey: serverEnv.VAPID_PUBLIC_KEY,
          privateKey: serverEnv.VAPID_PRIVATE_KEY,
          subject: serverEnv.VAPID_SUBJECT,
        }
      : undefined;
  if (vapid) sender ??= new WebPushSender(vapid);
  return {
    db: getDatabase(),
    mode: serverEnv.PUSH_DELIVERY,
    ...(vapid && sender ? { sender } : {}),
    now: () => new Date(),
  };
}

/** Public VAPID key for the browser subscription (not a secret). */
export function vapidPublicKey(): string | undefined {
  return serverEnv.VAPID_PUBLIC_KEY;
}
