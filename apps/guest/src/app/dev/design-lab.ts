import { type AppEnvironment } from "@up/core";

/** The internal Design Lab (/dev/*) exists only in local and staging – never in production. */
export function isDesignLabEnabled(appEnv: AppEnvironment): boolean {
  return appEnv === "local" || appEnv === "staging";
}
