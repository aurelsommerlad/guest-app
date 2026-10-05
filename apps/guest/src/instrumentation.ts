/**
 * Runs once per server instance on startup (Next.js instrumentation hook).
 * Validates the runtime environment and is the place to initialise error
 * monitoring (e.g. Sentry, EU region) in a later phase.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { serverEnv } = await import("./env/server");
    const { logger } = await import("./server/logger");
    logger.info("server started", { appEnv: serverEnv.APP_ENV });
  }
}
