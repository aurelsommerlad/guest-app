import { NextResponse } from "next/server";

import { type SessionGrant } from "./guest-access-service";
import { sessionCookieAttributes, type SessionCookieConfig } from "./session-cookie";

/**
 * Response of the link entry route `/{locale}/s/{token}`: always a 303 redirect to a
 * URL *without* the token – /stay with a fresh session cookie, or the neutral
 * invalid-link page. Never cached, never sends a Referer onwards.
 */
export function buildEntryResponse(input: {
  origin: string;
  locale: string;
  grant: SessionGrant | undefined;
  cookie: SessionCookieConfig;
  now: Date;
}): NextResponse {
  const target = input.grant ? `/${input.locale}/stay` : `/${input.locale}/link-invalid`;
  const response = NextResponse.redirect(new URL(target, input.origin), 303);
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (input.grant) {
    response.cookies.set(
      input.cookie.name,
      input.grant.secret,
      sessionCookieAttributes(input.cookie, input.grant.expiresAt, input.now),
    );
  }
  return response;
}
