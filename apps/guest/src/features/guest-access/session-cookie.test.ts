import { describe, expect, it } from "vitest";

import { buildEntryResponse } from "./entry-response";
import { sessionCookieAttributes, sessionCookieConfig } from "./session-cookie";

const now = new Date("2026-08-29T10:00:00Z");
const expiresAt = new Date(now.getTime() + 3600_000);
const TOKEN = "qY0o8m9Yy2s1oRgS3Hn0b6pYcM7m4p1Hc9e4lF0aXyZ";
const SECRET = "Zs0o8m9Yy2s1oRgS3Hn0b6pYcM7m4p1Hc9e4lF0aQwE";

describe("session cookie", () => {
  it("is HttpOnly, SameSite=Lax, Path=/ and Secure with __Host- prefix outside local", () => {
    for (const appEnv of ["staging", "production"] as const) {
      const config = sessionCookieConfig(appEnv);
      expect(config).toEqual({ name: "__Host-up_guest_session", secure: true });
      expect(sessionCookieAttributes(config, expiresAt, now)).toEqual({
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 3600,
      });
    }
  });

  it("works over http on localhost", () => {
    const config = sessionCookieConfig("local");
    expect(config).toEqual({ name: "up_guest_session", secure: false });
    expect(sessionCookieAttributes(config, expiresAt, now).httpOnly).toBe(true);
  });
});

describe("link entry response", () => {
  const cookie = sessionCookieConfig("production");

  it("redirects to /stay without the token and sets the session cookie", () => {
    const response = buildEntryResponse({
      origin: "https://stay.unique-places.com",
      locale: "de",
      grant: { secret: SECRET, expiresAt },
      cookie,
      now,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://stay.unique-places.com/de/stay");
    expect(response.headers.get("location")).not.toContain(TOKEN);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`__Host-up_guest_session=${SECRET}`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Max-Age=3600/);
    expect(setCookie).not.toMatch(/Domain=/i);
  });

  it("sends invalid links to the neutral page without setting a cookie", () => {
    const response = buildEntryResponse({
      origin: "https://stay.unique-places.com",
      locale: "en",
      grant: undefined,
      cookie,
      now,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://stay.unique-places.com/en/link-invalid");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
