import { createLogger, PmsError } from "@up/core";
import { createApaleoProvider } from "@up/integrations";
import { describe, expect, it } from "vitest";

import { buildStayViewModel } from "./build-stay-view-model";
import { toStaySource } from "./to-stay-source";

/** End-to-end in apaleo mode with mocked HTTP: Apaleo JSON → PmsReservation → StaySource → view model. */
function apaleoWith(reservation: Record<string, unknown>) {
  const responses = [
    new Response(JSON.stringify({ access_token: "token", expires_in: 3600, token_type: "Bearer" })),
    new Response(JSON.stringify(reservation)),
  ];
  const fetchFn = (() => {
    const next = responses.shift();
    return next ? Promise.resolve(next) : Promise.reject(new Error("unexpected request"));
  }) as typeof fetch;
  return createApaleoProvider({
    clientId: "id",
    clientSecret: "secret",
    logger: createLogger({ sink: () => undefined }),
    fetch: fetchFn,
    retryDelayMs: 0,
  });
}

const apaleoReservation = {
  id: "ABCDEFGH-1",
  status: "InHouse",
  arrival: "2026-08-27T16:00:00+02:00",
  departure: "2026-08-31T10:00:00+02:00",
  property: { id: "ALTUS", name: "HØV by UNIQUE PLACES" },
  unit: { id: "ALTUS-SWA", name: "ROS No. 2" },
  primaryGuest: { firstName: "Laura", lastName: "Muster", email: "laura@example.com" },
};

const options = { allowTestProperties: false, cardsFor: () => [] };

describe("STAY in apaleo mode (mocked HTTP)", () => {
  it("shows an Apaleo reservation with our branded property and unit", async () => {
    const reservation = await apaleoWith(apaleoReservation).getReservation("ABCDEFGH-1");
    const model = buildStayViewModel(
      toStaySource(reservation, options),
      "de",
      new Date("2026-08-29T12:00:00+02:00"),
    );

    expect(model.guest).toEqual({ firstName: "Laura" });
    expect(model.property).toEqual({ name: "HØV", spokenName: "Höv", location: "Altusried" });
    expect(model.unit.name).toBe("ROS");
    expect(model.status).toMatchObject({
      kind: "check-out",
      time: "10:00",
      date: "31. August 2026",
    });
    expect(JSON.stringify(model)).not.toContain("Muster");
  });

  it("fails cleanly for a reservation of an unknown property", async () => {
    const reservation = await apaleoWith({
      ...apaleoReservation,
      property: { id: "OTHER" },
    }).getReservation("X");
    expect(() => toStaySource(reservation, options)).toThrow(/unknown-property/);
  });

  it("propagates provider errors as PmsError", async () => {
    const provider = createApaleoProvider({
      clientId: "id",
      clientSecret: "secret",
      logger: createLogger({ sink: () => undefined }),
      fetch: () => Promise.resolve(new Response("{}", { status: 401 })),
      retryDelayMs: 0,
    });
    await expect(provider.getReservation("X")).rejects.toBeInstanceOf(PmsError);
  });
});
