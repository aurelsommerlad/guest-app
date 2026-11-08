import "server-only";

import { serverEnv } from "../../env/server";
import { getDatabase } from "../../server/database";
import { type NotificationsDeps } from "./notifications-service";

export function notificationsDeps(): NotificationsDeps {
  return {
    db: getDatabase(),
    mode: serverEnv.APP_ENV === "production" ? "off" : serverEnv.SLACK_DELIVERY,
    adminBaseUrl: serverEnv.NEXT_PUBLIC_APP_URL,
    now: () => new Date(),
  };
}
