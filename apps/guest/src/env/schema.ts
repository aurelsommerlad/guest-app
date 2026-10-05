import { appEnvironmentSchema, LOG_LEVELS, parseEnv } from "@up/core";
import { z } from "zod";

/**
 * Public variables – inlined into the client bundle at build time.
 * Never put secrets here.
 */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
});

/**
 * Server-only variables (secrets go here in later phases).
 */
export const serverEnvSchema = clientEnvSchema
  .extend({
    APP_ENV: appEnvironmentSchema,
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV !== "local" && !env.NEXT_PUBLIC_APP_URL.startsWith("https://")) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_APP_URL"],
        message: "must use https outside of local development",
      });
    }
  });

export type ClientEnv = z.infer<typeof clientEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function validateServerEnv(source: Record<string, string | undefined>): ServerEnv {
  return parseEnv(serverEnvSchema, source);
}
