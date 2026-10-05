import { hasLocale } from "next-intl";
import { type NextRequest } from "next/server";

import { buildEntryResponse } from "../../../../features/guest-access/entry-response";
import { enterWithLinkToken } from "../../../../features/guest-access/guest-access-service";
import { getGuestAccessDeps, guestSessionCookie } from "../../../../features/guest-access/server";
import { routing } from "../../../../i18n/routing";
import { logger } from "../../../../server/logger";

export const dynamic = "force-dynamic";

/**
 * Personal guest link `/{locale}/s/{token}`: validated only on the server, then
 * redirected (303) to a URL without the token. Invalid links of every kind end on the
 * same neutral page. The token is never logged or echoed.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string; token: string }> },
) {
  const { locale: requestedLocale, token } = await params;
  const locale = hasLocale(routing.locales, requestedLocale)
    ? requestedLocale
    : routing.defaultLocale;
  const deps = getGuestAccessDeps();
  if (!deps) logger.warn("guest link used but guest access is not configured");

  const grant = deps
    ? await enterWithLinkToken(deps, token, request.cookies.get(guestSessionCookie.name)?.value)
    : undefined;

  return buildEntryResponse({
    origin: request.nextUrl.origin,
    locale,
    grant,
    cookie: guestSessionCookie,
    now: new Date(),
  });
}
