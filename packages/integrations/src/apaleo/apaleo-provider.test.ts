import { PmsError } from "@up/core";
import { describe, expect, it } from "vitest";

import { createApaleoProvider } from "./apaleo-provider";
import {
  ACCESS_TOKEN,
  apaleoReservationPayload,
  capturingLogger,
  CLIENT_ID,
  CLIENT_SECRET,
  jsonResponse,
  scriptedFetch,
  tokenResponse,
} from "./test-helpers";

function setup(
  handlers: Parameters<typeof scriptedFetch>[0],
  options: { timeoutMs?: number } = {},
) {
  const { fetchFn, calls } = scriptedFetch(handlers);
  const { logger, lines } = capturingLogger();
  const provider = createApaleoProvider({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    logger,
    fetch: fetchFn,
    retryDelayMs: 0,
    timeoutMs: options.timeoutMs ?? 1_000,
  });
  return { provider, calls, lines };
}

async function expectPmsError(
  promise: Promise<unknown>,
  kind: PmsError["kind"],
): Promise<PmsError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(PmsError);
  expect((error as PmsError).kind).toBe(kind);
  return error as PmsError;
}

describe("ApaleoProvider.getReservation", () => {
  it("authenticates with client credentials and loads the reservation", async () => {
    const { provider, calls } = setup([
      () => tokenResponse(),
      () => jsonResponse(apaleoReservationPayload()),
    ]);

    const reservation = await provider.getReservation("ABCDEFGH-1");

    expect(reservation).toMatchObject({
      externalId: "ABCDEFGH-1",
      externalPropertyId: "ALTUS",
      status: "in-house",
    });
    const [token, api] = calls;
    expect(token?.url).toBe("https://identity.apaleo.com/connect/token");
    expect(token?.init?.method).toBe("POST");
    expect((token?.init?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
    );
    expect(token?.init?.body).toBe("grant_type=client_credentials");
    expect(api?.url).toBe("https://api.apaleo.com/booking/v1/reservations/ABCDEFGH-1");
    expect((api?.init?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${ACCESS_TOKEN}`,
    );
  });

  it("reuses the cached token for subsequent calls", async () => {
    const { provider, calls } = setup([
      () => tokenResponse(),
      () => jsonResponse(apaleoReservationPayload()),
      () => jsonResponse(apaleoReservationPayload()),
    ]);
    await provider.getReservation("ABCDEFGH-1");
    await provider.getReservation("ABCDEFGH-1");
    expect(calls.filter((call) => call.url.includes("connect/token"))).toHaveLength(1);
  });

  it("encodes the reservation id in the path", async () => {
    const { provider, calls } = setup([
      () => tokenResponse(),
      () => jsonResponse(apaleoReservationPayload()),
    ]);
    await provider.getReservation("A/B?C");
    expect(calls[1]?.url).toBe("https://api.apaleo.com/booking/v1/reservations/A%2FB%3FC");
  });

  it("reports rejected credentials as auth error", async () => {
    const { provider } = setup([() => jsonResponse({ error: "invalid_client" }, 400)]);
    await expectPmsError(provider.getReservation("X"), "auth");
  });

  it("reports missing permissions (403) as auth error", async () => {
    const { provider } = setup([() => tokenResponse(), () => jsonResponse({}, 403)]);
    await expectPmsError(provider.getReservation("X"), "auth");
  });

  it("fetches a fresh token once after a 401", async () => {
    const { provider, calls } = setup([
      () => tokenResponse(),
      () => jsonResponse({}, 401),
      () => tokenResponse(),
      () => jsonResponse(apaleoReservationPayload()),
    ]);
    await expect(provider.getReservation("X")).resolves.toMatchObject({ externalId: "ABCDEFGH-1" });
    expect(calls.filter((call) => call.url.includes("connect/token"))).toHaveLength(2);
  });

  it("reports an unknown reservation as not-found without retrying", async () => {
    const { provider, calls } = setup([() => tokenResponse(), () => jsonResponse({}, 404)]);
    await expectPmsError(provider.getReservation("missing"), "not-found");
    expect(calls).toHaveLength(2);
  });

  it("retries once on server errors, then succeeds", async () => {
    const { provider, calls } = setup([
      () => tokenResponse(),
      () => jsonResponse({}, 503),
      () => jsonResponse(apaleoReservationPayload()),
    ]);
    await expect(provider.getReservation("X")).resolves.toBeDefined();
    expect(calls).toHaveLength(3);
  });

  it("gives up after one retry", async () => {
    const { provider } = setup([
      () => tokenResponse(),
      () => jsonResponse({}, 500),
      () => jsonResponse({}, 502),
    ]);
    await expectPmsError(provider.getReservation("X"), "unavailable");
  });

  it("retries once on network errors", async () => {
    const { provider } = setup([
      () => tokenResponse(),
      () => Promise.reject(new TypeError("fetch failed")),
      () => Promise.reject(new TypeError("fetch failed")),
    ]);
    await expectPmsError(provider.getReservation("X"), "unavailable");
  });

  it("reports a timeout", async () => {
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(
            init.signal?.reason instanceof Error
              ? init.signal.reason
              : new DOMException("timeout", "TimeoutError"),
          );
        });
      });
    const { provider } = setup([() => tokenResponse(), hang], { timeoutMs: 20 });
    await expectPmsError(provider.getReservation("X"), "timeout");
  });

  it("rejects invalid responses", async () => {
    const { provider } = setup([
      () => tokenResponse(),
      () => jsonResponse({ id: "X", status: "InHouse" }),
    ]);
    await expectPmsError(provider.getReservation("X"), "invalid-response");
  });

  it("rejects non-JSON responses", async () => {
    const { provider } = setup([
      () => tokenResponse(),
      () => new Response("<html>oops</html>", { status: 200 }),
    ]);
    await expectPmsError(provider.getReservation("X"), "invalid-response");
  });

  it("rejects invalid token responses", async () => {
    const { provider } = setup([() => jsonResponse({ token: "x" })]);
    await expectPmsError(provider.getReservation("X"), "invalid-response");
  });

  it("never exposes secrets, tokens or guest data in errors or logs", async () => {
    const scenarios: Parameters<typeof setup>[0][] = [
      [() => jsonResponse({ error: "invalid_client", detail: CLIENT_SECRET }, 401)],
      [
        () => tokenResponse(),
        () => jsonResponse({ message: `bad token ${ACCESS_TOKEN}` }, 500),
        () => jsonResponse({}, 500),
      ],
      [
        () => tokenResponse(),
        () => jsonResponse(apaleoReservationPayload({ arrival: "not-a-date" })),
      ],
    ];
    for (const handlers of scenarios) {
      const { provider, lines } = setup(handlers);
      const error = await provider.getReservation("X").catch((e: unknown) => e as Error);
      const output = `${error instanceof Error ? `${error.name}: ${error.message}` : ""} ${JSON.stringify(error)} ${lines.join("\n")}`;
      for (const secret of [CLIENT_SECRET, ACCESS_TOKEN, "Laura", "laura@example.com", "Muster"]) {
        expect(output).not.toContain(secret);
      }
    }
  });

  it("logs structured context for failures", async () => {
    const { provider, lines } = setup([() => tokenResponse(), () => jsonResponse({}, 404)]);
    await provider.getReservation("X").catch(() => undefined);
    const failure = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.msg === "apaleo call failed");
    expect(failure).toMatchObject({
      provider: "apaleo",
      operation: "getReservation",
      kind: "not-found",
      status: 404,
      level: "error",
    });
  });
});
