import { serverEnv } from "../../../../env/server";
import { localVerificationOutbox } from "../../../../server/verification";

export const dynamic = "force-dynamic";

/**
 * Local end-to-end tests only: the newest simulated verification code for one recipient.
 * 404 everywhere else – the outbox exists only with APP_ENV=local and simulated delivery
 * (the env schema rejects "simulated" outside local development). Nothing is ever sent.
 */
export function GET(request: Request): Response {
  const outbox = localVerificationOutbox();
  if (serverEnv.APP_ENV !== "local" || !outbox) return new Response(null, { status: 404 });
  const url = new URL(request.url);
  const to = url.searchParams.get("to") ?? "";
  const channel = url.searchParams.get("channel") === "sms" ? "sms" : "email";
  const entry = outbox.latest(channel, to);
  if (!entry) return new Response(null, { status: 404 });
  return Response.json(
    { code: entry.message.code, at: entry.at.toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
