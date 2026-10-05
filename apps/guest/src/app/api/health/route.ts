import { serverEnv } from "../../../env/server";

export const dynamic = "force-dynamic";

/** Liveness check for deployments and uptime monitoring. Exposes no secrets. */
export function GET(): Response {
  return Response.json(
    {
      status: "ok",
      environment: serverEnv.APP_ENV,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
