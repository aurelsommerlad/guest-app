/** Validates the runtime environment once per server instance. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { serverEnv } = await import("./env/server");
    const { logger } = await import("./server/logger");
    logger.info("server started", { appEnv: serverEnv.APP_ENV });
  }
}
