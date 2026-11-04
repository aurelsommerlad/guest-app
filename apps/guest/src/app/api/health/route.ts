import { serverEnv } from "../../../env/server";
import { databaseHealth } from "../../../features/health/database-health";
import { getDatabase } from "../../../server/database";

export const dynamic = "force-dynamic";

/**
 * Liveness check for deployments and uptime monitoring. Exposes no secrets: the database
 * appears only as status, project fingerprint and migration count. Always 200 – a
 * database problem is reported in the body, not as a failed liveness check.
 */
export async function GET(): Promise<Response> {
  return Response.json(
    {
      status: "ok",
      environment: serverEnv.APP_ENV,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      database: await databaseHealth(getDatabase(), serverEnv.DATABASE_URL),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
