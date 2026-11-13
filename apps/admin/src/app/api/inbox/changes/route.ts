import { inboxChangeMarker } from "@up/db";

import { getAdminContext } from "../../../../features/auth/server";
import { inboxScopeFor } from "../../../../features/inbox/inbox-service";
import { getDatabase } from "../../../../server/database";

export const dynamic = "force-dynamic";

/**
 * Polling endpoint of the inbox: only the newest change and the unread count of the
 * conversations the signed-in admin may see (RLS scope) – never message content.
 */
export async function GET(): Promise<Response> {
  const admin = await getAdminContext();
  const scope = admin ? inboxScopeFor(admin) : undefined;
  if (!scope) return Response.json({ error: "unauthorized" }, { status: 401 });
  const marker = await inboxChangeMarker(getDatabase(), scope);
  return Response.json(marker, { headers: { "cache-control": "no-store" } });
}
