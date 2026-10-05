import { z } from "zod";

/**
 * Deployment environment of the platform.
 *
 * Deliberately separate from NODE_ENV: staging runs a production build
 * (NODE_ENV=production) but must use its own secrets, database and integrations.
 */
export const APP_ENVIRONMENTS = ["local", "staging", "production"] as const;

export const appEnvironmentSchema = z.enum(APP_ENVIRONMENTS);

export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;
