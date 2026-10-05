import "server-only";

import { createLogger } from "@up/core";

import { serverEnv } from "../env/server";

export const logger = createLogger({
  level: serverEnv.LOG_LEVEL,
  bindings: { service: "guest", appEnv: serverEnv.APP_ENV },
});
