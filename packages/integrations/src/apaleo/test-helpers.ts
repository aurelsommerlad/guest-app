import { createLogger, type LogLevel } from "@up/core";

export const CLIENT_ID = "test-client-id";
export const CLIENT_SECRET = "super-secret-value-123";
export const ACCESS_TOKEN = "eyJhbGciOi.secret-access-token";

/** A realistic (trimmed) Apaleo reservation payload, including fields we must NOT keep. */
export function apaleoReservationPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "ABCDEFGH-1",
    bookingId: "ABCDEFGH",
    status: "InHouse",
    arrival: "2026-08-27T16:00:00+02:00",
    departure: "2026-08-31T10:00:00+02:00",
    property: { id: "ALTUS", code: "ALTUS", name: "HØV by UNIQUE PLACES", description: "…" },
    unit: {
      id: "ALTUS-SWA",
      name: "ROS No. 2",
      description: "ROS No. 2",
      unitGroupId: "ALTUS-ROS2",
    },
    primaryGuest: {
      firstName: "Laura",
      lastName: "Muster",
      email: "laura@example.com",
      phone: "+49 123 456",
      address: { addressLine1: "Musterstraße 1", city: "Musterstadt" },
    },
    totalGrossAmount: { amount: 840, currency: "EUR" },
    ...overrides,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function tokenResponse(expiresIn = 3600): Response {
  return jsonResponse({ access_token: ACCESS_TOKEN, expires_in: expiresIn, token_type: "Bearer" });
}

/** Scripted fetch: each call takes the next handler; records requests. */
export function scriptedFetch(
  handlers: ((url: string, init?: RequestInit) => Response | Promise<Response>)[],
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    const handler = handlers.shift();
    if (!handler) throw new Error(`Unexpected request to ${url}`);
    return handler(url, init);
  }) as typeof fetch;
  return { fetchFn, calls };
}

export function capturingLogger(level: LogLevel = "debug") {
  const lines: string[] = [];
  const logger = createLogger({ level, sink: (_level, line) => lines.push(line) });
  return { logger, lines };
}
