import { type RegistrationSubmission } from "@up/core";
import { describe, expect, it } from "vitest";

import { ApaleoClient } from "./apaleo-client";
import {
  additionalGuestsFingerprint,
  ApaleoRegistrationWriteBack,
  mergeApaleoGuest,
} from "./apaleo-registration-writeback";
import {
  capturingLogger,
  CLIENT_ID,
  CLIENT_SECRET,
  jsonResponse,
  scriptedFetch,
  tokenResponse,
} from "./test-helpers";

const submission: RegistrationSubmission = {
  registrationId: "11111111-1111-4111-8111-111111111111",
  tenantId: "unique-places",
  propertyId: "hov",
  reservation: { provider: "apaleo", externalReservationId: "ABCDEFGH-1" },
  arrivalAt: "2026-08-27T16:00:00+02:00",
  departureAt: "2026-08-31T10:00:00+02:00",
  guests: [
    {
      position: 0,
      role: "primary",
      data: {
        firstName: "Laura",
        lastName: "Muster",
        birthDate: "1990-05-17",
        nationality: "DE",
        street: "Seeweg 3",
        postalCode: "88131",
        city: "Lindau",
        country: "DE",
      },
    },
    {
      position: 1,
      role: "companion",
      data: { firstName: "Mia", lastName: "Muster", birthDate: "2015-03-01" },
    },
  ],
  settings: {},
};

/** Existing Apaleo reservation with data we do not manage (e-mail, phone, company). */
function reservation(overrides: Record<string, unknown> = {}) {
  return {
    id: "ABCDEFGH-1",
    status: "Confirmed",
    primaryGuest: {
      firstName: "Laura",
      lastName: "Musterfrau",
      email: "laura@example.com",
      phone: "+49 123",
      company: { name: "Beispiel GmbH" },
      address: { addressLine1: "Alt 1", addressLine2: "c/o", city: "Alt", countryCode: "AT" },
    },
    totalGrossAmount: { amount: 840, currency: "EUR" },
    ...overrides,
  };
}

function setup(handlers: Parameters<typeof scriptedFetch>[0]) {
  const { fetchFn, calls } = scriptedFetch(handlers);
  const { logger, lines } = capturingLogger();
  const client = new ApaleoClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    logger,
    fetch: fetchFn,
    retryDelayMs: 0,
    timeoutMs: 1_000,
  });
  return { provider: new ApaleoRegistrationWriteBack(client, logger), calls, lines };
}

function patchBody(
  call: { init?: RequestInit } | undefined,
): { op: string; path: string; value: unknown }[] {
  return JSON.parse(call?.init?.body as string) as { op: string; path: string; value: unknown }[];
}

describe("Apaleo registration write-back", () => {
  it("reads first, merges the primary guest and adds fellow travellers", async () => {
    const { provider, calls, lines } = setup([
      () => tokenResponse(),
      () => jsonResponse(reservation()),
      () => new Response(null, { status: 204 }),
    ]);
    const outcome = await provider.submit(submission, {});
    expect(outcome).toMatchObject({ status: "synced", externalReference: "ABCDEFGH-1" });
    const patch = calls[2];
    expect(patch?.url).toBe("https://api.apaleo.com/booking/v1/reservations/ABCDEFGH-1");
    expect(patch?.init?.method).toBe("PATCH");
    expect((patch?.init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json-patch+json",
    );
    const [primary, additional] = patchBody(patch);
    expect(primary).toEqual({
      op: "replace",
      path: "/primaryGuest",
      value: {
        firstName: "Laura",
        lastName: "Muster",
        // Unmanaged fields are written back unchanged.
        email: "laura@example.com",
        phone: "+49 123",
        company: { name: "Beispiel GmbH" },
        birthDate: "1990-05-17",
        nationalityCountryCode: "DE",
        address: {
          addressLine1: "Seeweg 3",
          addressLine2: "c/o",
          city: "Lindau",
          countryCode: "DE",
          postalCode: "88131",
        },
      },
    });
    expect(additional).toEqual({
      op: "add",
      path: "/additionalGuests",
      value: [{ firstName: "Mia", lastName: "Muster", birthDate: "2015-03-01" }],
    });
    // Logs carry ids and outcome only.
    const log = lines.join("\n");
    for (const secret of [
      "Laura",
      "Muster",
      "Seeweg",
      "1990-05-17",
      "laura@example.com",
      CLIENT_SECRET,
    ]) {
      expect(log).not.toContain(secret);
    }
  });

  it("never overwrites fellow travellers maintained elsewhere", async () => {
    const { provider, calls } = setup([
      () => tokenResponse(),
      () =>
        jsonResponse(
          reservation({ additionalGuests: [{ firstName: "Max", lastName: "Front Desk" }] }),
        ),
    ]);
    expect(await provider.submit(submission, {})).toEqual({ status: "failed", code: "conflict" });
    expect(calls.some((call) => call.init?.method === "PATCH")).toBe(false);
  });

  it("replaces fellow travellers it wrote before and is idempotent", async () => {
    const ours = [mergeApaleoGuest(undefined, { firstName: "Old", lastName: "Name" })];
    const { provider, calls } = setup([
      () => tokenResponse(),
      () => jsonResponse(reservation({ additionalGuests: ours })),
      () => new Response(null, { status: 204 }),
      () =>
        jsonResponse(
          reservation({
            additionalGuests: [{ firstName: "Mia", lastName: "Muster", birthDate: "2015-03-01" }],
          }),
        ),
      () => new Response(null, { status: 204 }),
    ]);
    const first = await provider.submit(submission, {
      fingerprint: additionalGuestsFingerprint(ours),
    });
    expect(first.status).toBe("synced");
    expect(patchBody(calls[2]).map((op) => [op.op, op.path])).toEqual([
      ["replace", "/primaryGuest"],
      ["replace", "/additionalGuests"],
    ]);
    // Second run: Apaleo already has our travellers – only the (idempotent) primary replace.
    const second = await provider.submit(
      submission,
      first.status === "synced" ? { fingerprint: first.fingerprint ?? "" } : {},
    );
    expect(second).toEqual(first);
    expect(patchBody(calls[4]).map((op) => op.path)).toEqual(["/primaryGuest"]);
  });

  it("maps failures to retry or permanent outcomes without throwing", async () => {
    const cases: [Response, unknown][] = [
      [jsonResponse({}, 503), { status: "retry", code: "unavailable" }],
      [jsonResponse({}, 429), { status: "retry", code: "rate_limited" }],
      [jsonResponse({}, 403), { status: "failed", code: "auth" }],
      [jsonResponse({}, 404), { status: "failed", code: "not_found" }],
      [
        jsonResponse({ messages: ["Laura Muster invalid"] }, 422),
        { status: "failed", code: "rejected" },
      ],
    ];
    for (const [response, expected] of cases) {
      const { provider } = setup([
        () => tokenResponse(),
        () => jsonResponse(reservation()),
        () => response.clone(),
        () => response.clone(),
      ]);
      expect(await provider.submit(submission, {})).toEqual(expected);
    }
    const canceled = setup([
      () => tokenResponse(),
      () => jsonResponse(reservation({ status: "Canceled" })),
    ]);
    expect(await canceled.provider.submit(submission, {})).toEqual({
      status: "failed",
      code: "rejected",
    });
  });

  it("refuses non-Apaleo reservations and incomplete data without calling Apaleo", async () => {
    const { provider, calls } = setup([]);
    expect(
      await provider.submit(
        { ...submission, reservation: { provider: "mock", externalReservationId: "MOCK-1" } },
        {},
      ),
    ).toEqual({ status: "failed", code: "invalid_data" });
    expect(
      await provider.submit(
        { ...submission, guests: [{ position: 0, role: "primary", data: { firstName: "A" } }] },
        {},
      ),
    ).toEqual({ status: "failed", code: "invalid_data" });
    expect(calls).toHaveLength(0);
  });

  it("maps documents only when collected", () => {
    expect(mergeApaleoGuest(undefined, { firstName: "A", lastName: "B" })).toEqual({
      firstName: "A",
      lastName: "B",
    });
    expect(
      mergeApaleoGuest(undefined, {
        firstName: "A",
        lastName: "B",
        documentType: "passport",
        documentNumber: "C01X",
      }),
    ).toMatchObject({ identificationNumber: "C01X", identificationType: "PassportNumber" });
  });
});
