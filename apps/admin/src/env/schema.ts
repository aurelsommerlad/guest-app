import { appEnvironmentSchema, LOG_LEVELS, parseEnv } from "@up/core";
import { z } from "zod";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function postgresHost(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "postgres:" || parsed.protocol === "postgresql:"
      ? parsed.hostname
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Admin environment. Server-only except NEXT_PUBLIC_APP_URL. Secrets
 * (SUPABASE_SERVICE_ROLE_KEY, ADMIN_SETUP_TOKEN, DATABASE_URL) never reach the browser.
 */
export const serverEnvSchema = z
  .object({
    APP_ENV: appEnvironmentSchema,
    /** Public base URL of the admin app itself. */
    NEXT_PUBLIC_APP_URL: z.url(),
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
    /** Same database as the guest app (per environment). Required at runtime. */
    DATABASE_URL: z
      .string()
      .refine((url) => postgresHost(url) !== undefined, "must be a postgres:// URL")
      .optional(),
    /** Supabase project URL and server-side key – only for GUIDE media uploads. */
    SUPABASE_URL: z.url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
    GUIDE_MEDIA_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{2,62}$/)
      .default("guide-media"),
    /**
     * One-time bootstrap of the first admin account (/setup). Only effective while no
     * admin account exists at all; remove it afterwards.
     */
    ADMIN_SETUP_TOKEN: z.string().min(32).optional(),
  })
  .superRefine((env, ctx) => {
    const local = env.APP_ENV === "local";
    if (!local && !env.NEXT_PUBLIC_APP_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["NEXT_PUBLIC_APP_URL"], message: "must use https" });
    }
    if (env.DATABASE_URL && !local) {
      const host = postgresHost(env.DATABASE_URL);
      if (host && LOCAL_HOSTS.has(host)) {
        ctx.addIssue({
          code: "custom",
          path: ["DATABASE_URL"],
          message: "must not point to localhost outside of local development",
        });
      }
    }
    if (Boolean(env.SUPABASE_URL) !== Boolean(env.SUPABASE_SERVICE_ROLE_KEY)) {
      ctx.addIssue({
        code: "custom",
        path: ["SUPABASE_SERVICE_ROLE_KEY"],
        message: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set together",
      });
    }
    if (env.SUPABASE_URL && !env.SUPABASE_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["SUPABASE_URL"], message: "must use https" });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function validateServerEnv(source: Record<string, string | undefined>): ServerEnv {
  return parseEnv(serverEnvSchema, source);
}
