import { serverEnv } from "../../../env/server";
import { isAuthorizedCronRequest } from "../../../features/registration-sync/cron-auth";
import { runRegistrationSync } from "../../../features/registration-sync/server";

export const dynamic = "force-dynamic";

/**
 * Periodic registration sync (ADR 0016) – called by Vercel Cron with
 * "Authorization: Bearer <CRON_SECRET>". Without CRON_SECRET the endpoint does not exist.
 * Responds with counts only.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = serverEnv.CRON_SECRET;
  if (!secret) return new Response(null, { status: 404 });
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), secret)) {
    return new Response(null, { status: 401 });
  }
  const summary = await runRegistrationSync();
  return Response.json(summary ?? { claimed: 0, synced: 0, retry: 0, failed: 0 }, {
    headers: { "Cache-Control": "no-store" },
  });
}
