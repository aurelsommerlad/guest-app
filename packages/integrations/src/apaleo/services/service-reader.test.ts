import { createLogger } from "@up/core";
import { describe, expect, it } from "vitest";

import { ApaleoClient } from "../apaleo-client";
import { ApaleoServiceReader } from "./service-reader";

function clientWith(routes: Record<string, { status: number; body?: unknown }>) {
  const calls: { method: string; url: string }[] = [];
  const fetchFake: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (url.includes("identity")) {
      return Promise.resolve(
        Response.json({ access_token: "t", expires_in: 3600, token_type: "Bearer" }),
      );
    }
    const path = url.replace("https://api.apaleo.com", "");
    const route = routes[path];
    if (!route) return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(
      route.body === undefined
        ? new Response(null, { status: route.status })
        : Response.json(route.body, { status: route.status }),
    );
  };
  const client = new ApaleoClient({
    clientId: "id",
    clientSecret: "secret",
    logger: createLogger({ sink: () => undefined }),
    fetch: fetchFake,
    retryDelayMs: 0,
  });
  return { reader: new ApaleoServiceReader(client), calls };
}

describe("Apaleo service reader", () => {
  it("reads offers, booked services and definitions with GET only", async () => {
    const { reader, calls } = clientWith({
      "/booking/v1/reservations/R-1/service-offers": {
        status: 200,
        body: {
          services: [
            {
              service: { id: "TEST-LCO" },
              dates: [{ serviceDate: "2026-11-10", amount: { grossAmount: 25, currency: "EUR" } }],
            },
          ],
        },
      },
      "/booking/v1/reservations/R-1/services": { status: 204 },
      "/rateplan/v1/services/TEST-LCO": {
        status: 200,
        body: { id: "TEST-LCO", availability: { mode: "Departure" }, postNextDay: true },
      },
    });
    expect((await reader.getServiceOffers("R-1"))[0]?.service.id).toBe("TEST-LCO");
    expect(await reader.getBookedServices("R-1")).toEqual([]);
    expect(await reader.getServiceDefinition("TEST-LCO")).toMatchObject({ postNextDay: true });
    expect(calls.filter((c) => !c.url.includes("identity")).every((c) => c.method === "GET")).toBe(
      true,
    );
  });

  it("requests service offers exactly like Extras: no query parameters (no onlyDefaultDates)", async () => {
    const { reader, calls } = clientWith({
      "/booking/v1/reservations/R-2/service-offers": { status: 200, body: { services: [] } },
    });
    await reader.getServiceOffersForStay("R-2", "2099-01-02", new Date("2026-11-08T10:00:00Z"));
    const offerCalls = calls.filter((c) => c.url.includes("service-offers"));
    expect(offerCalls.map((c) => c.url)).toEqual([
      "https://api.apaleo.com/booking/v1/reservations/R-2/service-offers",
    ]);
  });

  it("treats a past departure and Apaleo's 422 as a past stay, like Extras", async () => {
    const { reader, calls } = clientWith({
      "/booking/v1/reservations/R-3/service-offers": { status: 422, body: { messages: [] } },
    });
    const today = new Date("2026-11-08T10:00:00Z");
    expect(await reader.getServiceOffersForStay("R-3", "2026-11-01", today)).toEqual({
      items: [],
      pastStay: true,
    });
    expect(calls.some((c) => c.url.includes("service-offers"))).toBe(false);
    expect(await reader.getServiceOffersForStay("R-3", "2026-11-09", today)).toEqual({
      items: [],
      pastStay: true,
    });
  });
});
