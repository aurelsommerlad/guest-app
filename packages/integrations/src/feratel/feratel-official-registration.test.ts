import {
  buildOfficialPayload,
  createLogger,
  initialOfficialRegistrationState,
  NO_CAPABILITIES,
  OFFICIAL_OPERATIONS,
  type OfficialOperation,
  type OfficialRegistrationState,
  type PmsReservation,
  type ProviderCapabilities,
  type RegistrationGuest,
  requestRetry,
  runOfficialRegistration,
  stayFactsFromReservation,
} from "@up/core";
import { describe, expect, it } from "vitest";

import { FERATEL_DOCUMENTED_CAPABILITIES } from "./feratel-capabilities";
import { FeratelOfficialRegistrationProvider } from "./feratel-official-registration-provider";
import { FeratelRegistrationProvider } from "./feratel-registration-provider";
import { type FeratelTransport } from "./feratel-transport";
import { SimulatedFeratelTransport } from "./simulated-feratel-transport";

/** Capabilities of the *simulation* only – the real interface has none documented yet. */
const SIMULATED: ProviderCapabilities = {
  ...(Object.fromEntries(OFFICIAL_OPERATIONS.map((op) => [op, true])) as Record<
    OfficialOperation,
    boolean
  >),
  idempotentWrites: true,
  guestCardStatus: true,
};

const REG = "0b7c2d4e-1111-4a2b-8c3d-5e6f7a8b9c0d";
const guests: RegistrationGuest[] = [
  {
    position: 0,
    role: "primary",
    data: {
      firstName: "Lea",
      lastName: "Beispiel",
      email: "lea@example.org",
      birthDate: "1985-02-02",
      nationality: "AT",
      street: "Dorfstraße 1",
      postalCode: "6793",
      city: "Gaschurn",
      country: "AT",
    },
  },
  {
    position: 1,
    role: "companion",
    data: { firstName: "Max", lastName: "Beispiel", birthDate: "2018-07-07" },
  },
];

function reservation(over: Partial<PmsReservation> = {}): PmsReservation {
  return {
    provider: "apaleo",
    externalId: "TEST-1",
    status: "confirmed",
    arrivalAt: "2026-12-20T16:00:00+01:00",
    departureAt: "2026-12-27T10:00:00+01:00",
    externalPropertyId: "TEST",
    primaryGuest: {},
    guestCount: { adults: 1, children: 1 },
    ...over,
  };
}

const settings = { mappingCode: "SIM-MAPPING" };
const logger = createLogger({ sink: () => undefined });

function setup(
  transport = new SimulatedFeratelTransport({ guestCards: true }),
  capabilities = SIMULATED,
) {
  const provider = new FeratelOfficialRegistrationProvider(
    transport,
    (propertyId) => (propertyId === "test-run" ? settings : undefined),
    capabilities,
  );
  let now = new Date("2026-12-01T09:00:00Z");
  let state: OfficialRegistrationState = initialOfficialRegistrationState({
    registrationId: REG,
    tenantId: "unique-places",
    propertyId: "test-run",
    target: "feratel",
    guestCardRelevant: true,
  });
  const step = async (res: PmsReservation, today: string) => {
    const stay = stayFactsFromReservation(res, "Europe/Vienna");
    const payload = buildOfficialPayload({
      registrationId: REG,
      stay,
      guests,
      guestCount: 2,
      childUnderAge: 15,
      confirmedPrimaryEmail: "lea@example.org",
    });
    const result = await runOfficialRegistration(
      { provider, now: () => now, logger },
      { state, payload, stay, gate: { open: true }, today, registrationDay: stay.arrivalDate },
    );
    state = result.state;
    return result;
  };
  return {
    transport,
    step,
    get state() {
      return state;
    },
    set state(next: OfficialRegistrationState) {
      state = next;
    },
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe("Feratel adapter (simulated)", () => {
  it("documented capabilities are empty – the real interface is not guessed", () => {
    expect(FERATEL_DOCUMENTED_CAPABILITIES).toEqual(NO_CAPABILITIES);
    expect(Object.values(FERATEL_DOCUMENTED_CAPABILITIES).every((value) => !value)).toBe(true);
  });

  it("refuses anything but the simulated transport", () => {
    const fake = {
      environment: "production",
      send: () => Promise.reject(new Error("no")),
    } as unknown as FeratelTransport;
    expect(() => new FeratelOfficialRegistrationProvider(fake, () => settings)).toThrow(
      /simulated/,
    );
  });

  it("the existing registration-sync provider stays inactive", () => {
    expect(FeratelRegistrationProvider.implemented).toBe(false);
  });

  it("with documented capabilities only, nothing is sent and staff takes over", async () => {
    const env = setup(new SimulatedFeratelTransport(), FERATEL_DOCUMENTED_CAPABILITIES);
    const result = await env.step(reservation(), "2026-12-20");
    expect(result.state).toMatchObject({ transmission: "manual", manualReason: "not-supported" });
    expect(env.transport.calls).toHaveLength(0);
  });

  it("unknown property settings → rejected, not sent", async () => {
    const transport = new SimulatedFeratelTransport();
    const provider = new FeratelOfficialRegistrationProvider(transport, () => undefined, SIMULATED);
    const outcome = await provider.execute({
      operation: "create-pre-registration",
      payload: buildOfficialPayload({
        registrationId: REG,
        stay: { arrivalDate: "2026-12-20", departureDate: "2026-12-27" },
        guests,
        guestCount: 2,
        childUnderAge: 15,
      }),
      idempotencyKey: "k",
      propertyId: "huesle",
    });
    expect(outcome).toEqual({ kind: "rejected", code: "not_configured" });
    expect(transport.calls).toHaveLength(0);
  });
});

describe("lifecycle with simulated Feratel answers", () => {
  it("pre-registration → card requested → registration on arrival → check-out", async () => {
    const env = setup();
    await env.step(reservation(), "2026-12-01");
    expect(env.state).toMatchObject({
      stage: "pre-registered",
      transmission: "confirmed",
      externalReference: "SIM-1",
    });
    expect(env.state.guestCard.status).toBe("requested");
    await env.step(reservation({ status: "in-house" }), "2026-12-20");
    expect(env.state.stage).toBe("registered");
    await env.step(reservation({ status: "checked-out" }), "2026-12-27");
    expect(env.state.stage).toBe("checked-out");
    expect(env.transport.stageOf("SIM-1")).toBe("checked-out");
    expect(env.transport.registrationCount).toBe(1);
    expect(env.transport.calls.map((call) => call.operation)).toEqual([
      "create-pre-registration",
      "convert-to-registration",
      "check-out",
    ]);
  });

  it("Apaleo change before arrival updates the pre-registration", async () => {
    const env = setup();
    await env.step(reservation(), "2026-12-01");
    await env.step(reservation({ departureAt: "2026-12-29T10:00:00+01:00" }), "2026-12-05");
    expect(env.transport.calls.at(-1)?.operation).toBe("update-pre-registration");
    expect(env.state.acceptedStay).toEqual({
      arrivalDate: "2026-12-20",
      departureDate: "2026-12-29",
    });
  });

  it("Apaleo extension during the stay updates the departure", async () => {
    const env = setup();
    await env.step(reservation(), "2026-12-01");
    await env.step(reservation(), "2026-12-20");
    await env.step(reservation({ departureAt: "2026-12-30T10:00:00+01:00" }), "2026-12-22");
    expect(env.transport.calls.at(-1)?.operation).toBe("update-departure");
    expect(env.state.acceptedStay?.departureDate).toBe("2026-12-30");
  });

  it("Apaleo cancellation before arrival deletes the pre-registration", async () => {
    const env = setup();
    await env.step(reservation(), "2026-12-01");
    await env.step(reservation({ status: "canceled" }), "2026-12-03");
    expect(env.state.stage).toBe("cancelled");
    expect(env.transport.stageOf("SIM-1")).toBe("cancelled");
    // repeated runs after cancellation do nothing
    await env.step(reservation({ status: "canceled" }), "2026-12-04");
    expect(env.transport.calls).toHaveLength(2);
  });

  it("cancellation of a binding registration without documented support → staff", async () => {
    const env = setup(new SimulatedFeratelTransport(), {
      ...SIMULATED,
      "cancel-registration": false,
    });
    // Arrival day: the binding registration is created directly.
    await env.step(reservation(), "2026-12-20");
    expect(env.state.stage).toBe("registered");
    await env.step(reservation({ status: "canceled" }), "2026-12-21");
    expect(env.state).toMatchObject({
      transmission: "manual",
      manualReason: "cancelled-after-registration",
    });
  });
});

describe("errors and retries (simulated)", () => {
  it("temporary error → backoff → success on retry, no duplicate", async () => {
    const env = setup(new SimulatedFeratelTransport().failNext({ error: "unavailable" }));
    await env.step(reservation(), "2026-12-01");
    expect(env.state).toMatchObject({ stage: "none", attempts: 1, lastErrorCode: "unavailable" });
    const waiting = await env.step(reservation(), "2026-12-01");
    expect(waiting.plan).toEqual({ kind: "wait", reason: "backoff" });
    env.advance(61_000);
    await env.step(reservation(), "2026-12-01");
    expect(env.state.stage).toBe("pre-registered");
    expect(env.transport.registrationCount).toBe(1);
  });

  it("timeout after the target processed the create → reconciled by lookup, no duplicate", async () => {
    const env = setup(
      new SimulatedFeratelTransport().failNext({ error: "timeout", processed: true }),
    );
    await env.step(reservation(), "2026-12-01");
    expect(env.state.unresolved?.operation).toBe("create-pre-registration");
    env.advance(61_000);
    await env.step(reservation(), "2026-12-01");
    expect(env.transport.calls.map((call) => call.operation)).toEqual([
      "create-pre-registration",
      "lookup-by-reference",
    ]);
    expect(env.state).toMatchObject({ stage: "pre-registered", externalReference: "SIM-1" });
    expect(env.transport.registrationCount).toBe(1);
  });

  it("timeout where nothing was processed → lookup finds nothing → created once", async () => {
    const env = setup(
      new SimulatedFeratelTransport().failNext({ error: "timeout", processed: false }),
    );
    await env.step(reservation(), "2026-12-01");
    env.advance(61_000);
    await env.step(reservation(), "2026-12-01"); // lookup → none
    expect(env.state).toMatchObject({ stage: "none", transmission: "pending" });
    await env.step(reservation(), "2026-12-01"); // create again
    expect(env.state.stage).toBe("pre-registered");
    expect(env.transport.registrationCount).toBe(1);
  });

  it("without lookup support an unclear create goes to staff – never re-sent", async () => {
    const env = setup(
      new SimulatedFeratelTransport().failNext({ error: "timeout", processed: true }),
      {
        ...SIMULATED,
        "lookup-by-reference": false,
      },
    );
    await env.step(reservation(), "2026-12-01");
    env.advance(61_000);
    await env.step(reservation(), "2026-12-01");
    expect(env.state).toMatchObject({ transmission: "manual", manualReason: "ambiguous-outcome" });
    expect(env.transport.calls).toHaveLength(1);
    expect(requestRetry(env.state, "adm-1", new Date())).toEqual({
      ok: false,
      reason: "resolve-ambiguity-first",
    });
  });

  it("validation and auth errors fail immediately and wait for staff", async () => {
    for (const error of ["validation", "auth"] as const) {
      const env = setup(new SimulatedFeratelTransport().failNext({ error }));
      await env.step(reservation(), "2026-12-01");
      expect(env.state.transmission).toBe("failed");
      await env.step(reservation(), "2026-12-01");
      expect(env.transport.calls).toHaveLength(1);
      const retry = requestRetry(env.state, "adm-1", new Date());
      expect(retry.ok).toBe(true);
      if (retry.ok) env.state = retry.state;
      await env.step(reservation(), "2026-12-01");
      expect(env.state.stage).toBe("pre-registered");
    }
  });

  it("repeated create with the same idempotency key returns the same record", async () => {
    const transport = new SimulatedFeratelTransport();
    const provider = new FeratelOfficialRegistrationProvider(transport, () => settings, SIMULATED);
    const request = {
      operation: "create-registration" as const,
      payload: buildOfficialPayload({
        registrationId: REG,
        stay: { arrivalDate: "2026-12-20", departureDate: "2026-12-27" },
        guests,
        guestCount: 2,
        childUnderAge: 15,
      }),
      idempotencyKey: "same",
      propertyId: "test-run",
    };
    const a = await provider.execute(request);
    const b = await provider.execute(request);
    expect(a).toEqual(b);
    expect(transport.registrationCount).toBe(1);
  });

  it("the transport never receives phone numbers or internal contact data", async () => {
    const transport = new SimulatedFeratelTransport();
    const seen: string[] = [];
    const spy: FeratelTransport = {
      environment: "simulated",
      send: (request) => {
        seen.push(JSON.stringify(request.payload));
        return transport.send(request);
      },
    };
    const provider = new FeratelOfficialRegistrationProvider(spy, () => settings, SIMULATED);
    await provider.execute({
      operation: "create-pre-registration",
      payload: buildOfficialPayload({
        registrationId: REG,
        stay: { arrivalDate: "2026-12-20", departureDate: "2026-12-27" },
        guests: [
          {
            ...guests[0],
            data: { ...guests[0]?.data, phone: "+436641234567" },
          } as RegistrationGuest,
        ],
        guestCount: 1,
        childUnderAge: 15,
      }),
      idempotencyKey: "k",
      propertyId: "test-run",
    });
    expect(seen.join()).not.toContain("+43664");
    expect(seen.join()).not.toContain("lea@example.org"); // not confirmed → no card e-mail
  });
});
