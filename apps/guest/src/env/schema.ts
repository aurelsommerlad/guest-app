import { appEnvironmentSchema, isEntityKey, LOG_LEVELS, parseEnv } from "@up/core";
import { z } from "zod";

/**
 * Public variables – inlined into the client bundle at build time.
 * Never put secrets here.
 */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
});

export const STAY_DATA_SOURCES = ["mock", "apaleo"] as const;

/**
 * preview: /stay without a guest session shows the preview stay (mock or the configured
 *          Apaleo preview reservation) – the development workflow.
 * secured: /stay requires a guest session (personal link or booking number login).
 * Production must run `secured` before real guests use it (ADR 0011).
 */
export const GUEST_ACCESS_MODES = ["preview", "secured"] as const;

/** Apaleo write-back of the online check-in (ADR 0016) – off unless explicitly enabled. */
export const REGISTRATION_WRITEBACK_MODES = ["disabled", "enabled"] as const;

function isAccessCodeKey(value: string): boolean {
  // 43 base64 characters + one padding character = exactly 32 bytes.
  return /^[A-Za-z0-9+/]{43}=$/.test(value);
}

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function databaseHost(url: string): string | undefined {
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
 * Server-only variables. Secrets (APALEO_CLIENT_SECRET) live here and are never
 * exposed to the client (server.ts is `server-only`).
 */
export const serverEnvSchema = clientEnvSchema
  .extend({
    APP_ENV: appEnvironmentSchema,
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
    /** Where the STAY screen gets its reservation from. Default: mock data. */
    STAY_DATA_SOURCE: z.enum(STAY_DATA_SOURCES).default("mock"),
    /** Apaleo simple client (OAuth client credentials) – required in apaleo mode. */
    APALEO_CLIENT_ID: z.string().min(1).optional(),
    APALEO_CLIENT_SECRET: z.string().min(1).optional(),
    /**
     * The one Apaleo reservation shown in local/staging (preview) until guest access exists.
     * Never allowed in production.
     */
    APALEO_PREVIEW_RESERVATION_ID: z.string().min(1).optional(),
    /**
     * Server-side Postgres connection (Supabase transaction pooler) – one database per
     * environment. Optional: nothing in the app reads the database yet (Phase 6).
     */
    GUEST_ACCESS_MODE: z.enum(GUEST_ACCESS_MODES).default("preview"),
    /**
     * Tenant served by this deployment (guest login). Precursor of host-based tenant
     * resolution; guest links carry their tenant themselves.
     */
    GUEST_TENANT_SLUG: z.string().refine(isEntityKey, "must be a tenant slug").optional(),
    /**
     * Supabase project URL – only to allow its public Storage images (GUIDE media) in
     * next/image. No key: the guest app never talks to Supabase APIs.
     */
    SUPABASE_URL: z.url().optional(),
    DATABASE_URL: z
      .string()
      .refine((url) => databaseHost(url) !== undefined, "must be a postgres:// URL")
      .optional(),
    /**
     * 32-byte key (base64) for key box codes at rest (AES-256-GCM, ADR 0017). Without it,
     * key box properties show their manual instructions instead of a code.
     */
    ACCESS_CODE_KEY: z.string().refine(isAccessCodeKey, "must be 32 bytes, base64").optional(),
    /** Write submitted online check-ins back to Apaleo (needs scope reservations.manage). */
    APALEO_REGISTRATION_WRITEBACK: z.enum(REGISTRATION_WRITEBACK_MODES).default("disabled"),
    /** Bearer secret for the registration sync endpoint (Vercel Cron sends it). */
    CRON_SECRET: z.string().min(32).optional(),
    /**
     * Local development only: reference time of the mock preview stay (ISO 8601), to look at
     * the journey states (before arrival, arrival day, departure day). Rejected elsewhere.
     */
    PREVIEW_NOW: z.iso.datetime({ offset: true }).optional(),
    /** Separate Extras app (linked without any reservation data in the URL). */
    EXTRAS_APP_URL: z.url().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV !== "local" && !env.NEXT_PUBLIC_APP_URL.startsWith("https://")) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_APP_URL"],
        message: "must use https outside of local development",
      });
    }
    if (env.APP_ENV === "production") {
      // Without guest access there is no legitimate way to pick a reservation in production.
      if (env.STAY_DATA_SOURCE === "apaleo") {
        ctx.addIssue({
          code: "custom",
          path: ["STAY_DATA_SOURCE"],
          message: "apaleo is not allowed in production until guest access exists",
        });
      }
      if (env.APALEO_PREVIEW_RESERVATION_ID) {
        ctx.addIssue({
          code: "custom",
          path: ["APALEO_PREVIEW_RESERVATION_ID"],
          message: "a preview reservation must never be configured in production",
        });
      }
    }
    if (env.DATABASE_URL && env.APP_ENV !== "local") {
      const host = databaseHost(env.DATABASE_URL);
      if (host && LOCAL_DATABASE_HOSTS.has(host)) {
        ctx.addIssue({
          code: "custom",
          path: ["DATABASE_URL"],
          message: "must not point to localhost outside of local development",
        });
      }
    }
    if (env.GUEST_ACCESS_MODE === "secured") {
      for (const key of ["DATABASE_URL", "GUEST_TENANT_SLUG"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "required when GUEST_ACCESS_MODE=secured",
          });
        }
      }
      if (env.APP_ENV === "production") {
        // The mock PMS is never used in production, so secured mode needs Apaleo.
        for (const key of ["APALEO_CLIENT_ID", "APALEO_CLIENT_SECRET"] as const) {
          if (!env[key]) {
            ctx.addIssue({
              code: "custom",
              path: [key],
              message: "required for secured guest access in production",
            });
          }
        }
      }
    }
    if (env.PREVIEW_NOW && env.APP_ENV !== "local") {
      ctx.addIssue({ code: "custom", path: ["PREVIEW_NOW"], message: "only allowed locally" });
    }
    if (env.APALEO_REGISTRATION_WRITEBACK === "enabled") {
      for (const key of ["APALEO_CLIENT_ID", "APALEO_CLIENT_SECRET", "DATABASE_URL"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "required when APALEO_REGISTRATION_WRITEBACK=enabled",
          });
        }
      }
    }
    if (
      env.EXTRAS_APP_URL &&
      !env.EXTRAS_APP_URL.startsWith("https://") &&
      env.APP_ENV !== "local"
    ) {
      ctx.addIssue({ code: "custom", path: ["EXTRAS_APP_URL"], message: "must use https" });
    }
    if (env.APALEO_REGISTRATION_WRITEBACK === "enabled") {
      for (const key of ["APALEO_CLIENT_ID", "APALEO_CLIENT_SECRET", "DATABASE_URL"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "required when APALEO_REGISTRATION_WRITEBACK=enabled",
          });
        }
      }
    }
    if (
      env.EXTRAS_APP_URL &&
      !env.EXTRAS_APP_URL.startsWith("https://") &&
      env.APP_ENV !== "local"
    ) {
      ctx.addIssue({ code: "custom", path: ["EXTRAS_APP_URL"], message: "must use https" });
    }
    if (env.STAY_DATA_SOURCE === "apaleo") {
      for (const key of [
        "APALEO_CLIENT_ID",
        "APALEO_CLIENT_SECRET",
        "APALEO_PREVIEW_RESERVATION_ID",
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "required when STAY_DATA_SOURCE=apaleo",
          });
        }
      }
    }
  });

export type ClientEnv = z.infer<typeof clientEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function validateServerEnv(source: Record<string, string | undefined>): ServerEnv {
  return parseEnv(serverEnvSchema, source);
}
