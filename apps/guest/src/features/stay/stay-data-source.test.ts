import { describe, expect, it } from "vitest";

import { resolveStayDataSource } from "./stay-data-source";

describe("resolveStayDataSource", () => {
  it("uses mock data by default", () => {
    expect(
      resolveStayDataSource({ APP_ENV: "staging", STAY_DATA_SOURCE: "mock" }, "MOCK-1"),
    ).toEqual({
      kind: "mock",
      reservationId: "MOCK-1",
    });
  });

  it("uses the server-side preview reservation in apaleo mode", () => {
    expect(
      resolveStayDataSource(
        {
          APP_ENV: "staging",
          STAY_DATA_SOURCE: "apaleo",
          APALEO_CLIENT_ID: "id",
          APALEO_CLIENT_SECRET: "secret",
          APALEO_PREVIEW_RESERVATION_ID: "ABCDEFGH-1",
        },
        "MOCK-1",
      ),
    ).toEqual({
      kind: "apaleo",
      reservationId: "ABCDEFGH-1",
      clientId: "id",
      clientSecret: "secret",
    });
  });

  it("refuses apaleo mode in production or without configuration", () => {
    const apaleo = {
      STAY_DATA_SOURCE: "apaleo" as const,
      APALEO_CLIENT_ID: "id",
      APALEO_CLIENT_SECRET: "secret",
      APALEO_PREVIEW_RESERVATION_ID: "ABCDEFGH-1",
    };
    expect(() => resolveStayDataSource({ APP_ENV: "production", ...apaleo }, "MOCK-1")).toThrow();
    expect(() =>
      resolveStayDataSource({ APP_ENV: "staging", STAY_DATA_SOURCE: "apaleo" }, "MOCK-1"),
    ).toThrow();
  });
});
