import { describe, expect, it } from "vitest";

import { createLogger } from "../logging/logger";
import { type PmsReservation } from "../pms/pms-provider";
import { type RegistrationGuest } from "../registration/registration-model";
import { MAX_SYNC_ATTEMPTS } from "../registration/registration-sync";
import {
  guestCardAfterRegistration,
  requestRetry,
  resolveManually,
  updateGuestCard,
} from "./admin-actions";
import { evaluateOfficialGate, officialRegistrationModeSchema } from "./gate";
import {
  initialOfficialRegistrationState,
  NO_CAPABILITIES,
  OFFICIAL_OPERATIONS,
  type OfficialOperation,
  type OfficialRegistrationState,
  type ProviderCapabilities,
} from "./model";
import { applyOutcome, type ProviderOutcome } from "./outcome";
import {
  bindingRegistrationDate,
  effectiveCapabilities,
  officialRegistrationSettingsSchema,
  preRegistrationOpensOn,
} from "./settings";
import {
  buildOfficialPayload,
  guestDataFingerprint,
  idempotencyKey,
  officialReference,
  payloadFingerprint,
} from "./payload";
import { planOfficialRegistration, type PlanInput } from "./planner";
import { type OfficialRegistrationProvider, type OfficialRequest } from "./provider";
import { runOfficialRegistration } from "./run";
import { stayFactsFromReservation, type StayFacts } from "./stay-facts";

const ALL: ProviderCapabilities = {
  ...(Object.fromEntries(OFFICIAL_OPERATIONS.map((op) => [op, true])) as Record<
    OfficialOperation,
    boolean
  >),
  idempotentWrites: true,
  guestCardStatus: false,
};

const REG_ID = "6c1f9a3e-6a5e-4b7e-9f55-1f7f3b2b6a10";
const primary: RegistrationGuest = {
  position: 0,
  role: "primary",
  data: {
    firstName: "Anna",
    lastName: "Muster",
    email: "anna@example.org",
    phone: "+491701234567",
    birthDate: "1980-05-01",
    nationality: "DE",
    street: "Seestraße 12",
    postalCode: "88131",
    city: "Lindau",
    country: "DE",
  },
};
const child: RegistrationGuest = {
  position: 1,
  role: "companion",
  data: { firstName: "Ben", lastName: "Muster", birthDate: "2016-03-01", phone: "+491701234568" },
};
const guests: RegistrationGuest[] = [
  primary,
  child,
  { position: 2, role: "companion", data: { firstName: "Cleo", lastName: "Muster" } },
];
const stay: StayFacts = {
  status: "confirmed",
  arrivalDate: "2026-12-20",
  departureDate: "2026-12-27",
};
const openGate = { open: true } as const;

function payloadFor(s: StayFacts = stay, list = guests) {
  return buildOfficialPayload({
    registrationId: REG_ID,
    stay: { arrivalDate: s.arrivalDate, departureDate: s.departureDate },
    guests: list,
    guestCount: 2,
    childUnderAge: 15,
    confirmedPrimaryEmail: "anna@example.org",
  });
}

function state(over: Partial<OfficialRegistrationState> = {}): OfficialRegistrationState {
  return {
    ...initialOfficialRegistrationState({
      registrationId: REG_ID,
      tenantId: "unique-places",
      propertyId: "test-run",
      target: "feratel",
      guestCardRelevant: true,
    }),
    ...over,
  };
}

const NOW = new Date("2026-12-01T10:00:00Z");

const SETTINGS = {
  target: "feratel",
  enabled: true,
  environment: "simulated",
  bindingRegistration: { rule: "arrival-day" },
  allowedOperations: [...OFFICIAL_OPERATIONS],
  guestCards: true,
  childUnderAge: 15,
  providerSettings: { mappingCode: "SIM" },
} as const;

function plan(over: Partial<PlanInput> & { payload?: ReturnType<typeof payloadFor> } = {}) {
  const payload = over.payload ?? payloadFor(over.stay ?? stay);
  return planOfficialRegistration({
    state: state(),
    stay,
    gate: openGate,
    capabilities: ALL,
    fingerprint: payloadFingerprint(payload),
    guestFingerprint: guestDataFingerprint(payload),
    today: "2026-12-01",
    registrationDay: (over.stay ?? stay).arrivalDate,
    now: NOW,
    ...over,
  });
}

/* ---------------------------------------------------------------------------------------- */

describe("stay facts from the PMS", () => {
  const reservation: PmsReservation = {
    provider: "apaleo",
    externalId: "ABC-1",
    status: "confirmed",
    arrivalAt: "2026-12-20T15:00:00+01:00",
    departureAt: "2026-12-27T10:00:00+01:00",
    externalPropertyId: "ALPILA",
    primaryGuest: {},
    guestCount: { adults: 2, children: 1 },
  };

  it("uses local dates of the property", () => {
    expect(stayFactsFromReservation(reservation, "Europe/Vienna")).toEqual({
      status: "confirmed",
      arrivalDate: "2026-12-20",
      departureDate: "2026-12-27",
      guestCount: 3,
    });
  });

  it("an instant just after midnight UTC is still the evening before in a western zone", () => {
    const late = { ...reservation, arrivalAt: "2026-12-20T00:30:00Z" };
    expect(stayFactsFromReservation(late, "America/New_York").arrivalDate).toBe("2026-12-19");
  });

  it("rejects broken dates", () => {
    expect(() =>
      stayFactsFromReservation({ ...reservation, arrivalAt: "x" }, "Europe/Vienna"),
    ).toThrow();
  });
});

describe("payload", () => {
  it("contains legal data only, plus the confirmed main guest e-mail for the card", () => {
    const payload = payloadFor();
    expect(payload.reference).toBe(officialReference(REG_ID));
    expect(payload.guests).toHaveLength(2); // guest count 2 → third traveller dropped
    expect(JSON.stringify(payload)).not.toContain("+4917");
    expect(payload.guests[0]?.data).not.toHaveProperty("email");
    expect(payload.guestCardEmail).toBe("anna@example.org");
  });

  it("takes only the dates from the stay – a PMS status change is no data change", () => {
    const confirmed = payloadFor(stay);
    const inHouse = payloadFor({ ...stay, status: "in-house" });
    expect(confirmed.stay).toEqual({ arrivalDate: "2026-12-20", departureDate: "2026-12-27" });
    expect(payloadFingerprint(inHouse)).toBe(payloadFingerprint(confirmed));
  });

  it("marks children by age at arrival", () => {
    const payload = payloadFor();
    expect(payload.guests.map((guest) => guest.child)).toEqual([false, true]);
  });

  it("omits the card e-mail when not confirmed", () => {
    const payload = buildOfficialPayload({
      registrationId: REG_ID,
      stay,
      guests,
      guestCount: 1,
      childUnderAge: 15,
    });
    expect(payload).not.toHaveProperty("guestCardEmail");
  });

  it("fingerprints detect changes; the guest fingerprint ignores dates", () => {
    const a = payloadFor();
    const b = payloadFor({ ...stay, departureDate: "2026-12-28" });
    expect(payloadFingerprint(a)).not.toBe(payloadFingerprint(b));
    expect(guestDataFingerprint(a)).toBe(guestDataFingerprint(b));
    expect(payloadFingerprint(a)).toBe(payloadFingerprint(payloadFor()));
  });

  it("idempotency keys depend on registration, operation and content", () => {
    const k = idempotencyKey(REG_ID, "create-registration", "f1");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(idempotencyKey(REG_ID, "create-registration", "f2")).not.toBe(k);
    expect(idempotencyKey(REG_ID, "check-out", "f1")).not.toBe(k);
  });
});

describe("gate", () => {
  const property = officialRegistrationSettingsSchema.parse(SETTINGS);
  const input = {
    mode: "simulated" as const,
    property,
    propertyIsTestOnly: true,
    registrationSubmitted: true,
    completenessBlockers: [],
  };

  it("open only when everything agrees", () => {
    expect(evaluateOfficialGate(input)).toEqual({ open: true });
  });

  it("collects every reason", () => {
    expect(
      evaluateOfficialGate({
        ...input,
        mode: "disabled",
        propertyIsTestOnly: false,
        registrationSubmitted: false,
        completenessBlockers: ["email-not-verified"],
      }),
    ).toEqual({
      open: false,
      reasons: ["mode-disabled", "live-property", "not-submitted", "check-in-incomplete"],
    });
    expect(evaluateOfficialGate({ ...input, property: undefined })).toMatchObject({
      reasons: ["property-not-enabled"],
    });
  });

  it("test and production cannot be configured in F1", () => {
    expect(officialRegistrationModeSchema.safeParse("test").success).toBe(false);
    expect(officialRegistrationModeSchema.safeParse("production").success).toBe(false);
    expect(
      officialRegistrationSettingsSchema.safeParse({ ...property, environment: "production" })
        .success,
    ).toBe(false);
    // Prepared but switched off is fine.
    expect(
      officialRegistrationSettingsSchema.safeParse({
        ...property,
        enabled: false,
        environment: "production",
      }).success,
    ).toBe(true);
  });
});

describe("settings", () => {
  it("binding registration day: arrival day or N days before", () => {
    expect(bindingRegistrationDate(stay, { rule: "arrival-day" })).toBe("2026-12-20");
    expect(bindingRegistrationDate(stay, { rule: "days-before-arrival", days: 14 })).toBe(
      "2026-12-06",
    );
    expect(
      bindingRegistrationDate(
        { arrivalDate: "2027-03-01", departureDate: "2027-03-05" },
        { rule: "days-before-arrival", days: 1 },
      ),
    ).toBe("2027-02-28");
  });

  it("pre-registration window", () => {
    expect(preRegistrationOpensOn(stay, undefined)).toBeUndefined();
    expect(preRegistrationOpensOn(stay, 14)).toBe("2026-12-06");
  });

  it("effective capabilities = documented ∩ confirmed for the destination", () => {
    const effective = effectiveCapabilities(ALL, ["create-registration", "check-out"]);
    expect(effective["create-registration"]).toBe(true);
    expect(effective["update-departure"]).toBe(false);
    expect(effectiveCapabilities(NO_CAPABILITIES, ["update-departure"])["update-departure"]).toBe(
      false,
    );
  });

  it("validates the stored document", () => {
    expect(officialRegistrationSettingsSchema.safeParse(SETTINGS).success).toBe(true);
    for (const broken of [
      { ...SETTINGS, allowedOperations: ["create-registration", "create-registration"] },
      { ...SETTINGS, allowedOperations: ["delete-everything"] },
      { ...SETTINGS, bindingRegistration: { rule: "days-before-arrival", days: 0 } },
      { ...SETTINGS, providerSettings: { "bad key": "x" } },
      { ...SETTINGS, eventRetentionDays: 0 },
    ]) {
      expect(officialRegistrationSettingsSchema.safeParse(broken).success).toBe(false);
    }
  });
});

describe("planner timing from settings", () => {
  it("binding registration N days before arrival", () => {
    expect(plan({ today: "2026-12-06", registrationDay: "2026-12-06" })).toEqual({
      kind: "execute",
      operation: "create-registration",
    });
  });

  it("pre-registration not before its window opens", () => {
    expect(plan({ today: "2026-12-01", preRegistrationFrom: "2026-12-06" })).toEqual({
      kind: "wait",
      reason: "before-registration-day",
    });
    expect(plan({ today: "2026-12-06", preRegistrationFrom: "2026-12-06" })).toEqual({
      kind: "execute",
      operation: "create-pre-registration",
    });
  });
});

describe("planner", () => {
  it("gate closed → waits, nothing is sent", () => {
    expect(plan({ gate: { open: false, reasons: ["not-submitted"] } })).toEqual({
      kind: "wait",
      reason: "gate-closed",
    });
  });

  it("before arrival: pre-registration if supported, else wait", () => {
    expect(plan()).toEqual({ kind: "execute", operation: "create-pre-registration" });
    expect(plan({ capabilities: { ...ALL, "create-pre-registration": false } })).toEqual({
      kind: "wait",
      reason: "before-registration-day",
    });
  });

  it("on the arrival day: binding registration", () => {
    expect(plan({ today: "2026-12-20" })).toEqual({
      kind: "execute",
      operation: "create-registration",
    });
  });

  it("pre-registration: update on change, convert on arrival day", () => {
    const p = payloadFor();
    const pre = state({
      stage: "pre-registered",
      transmission: "confirmed",
      externalReference: "R1",
      acceptedFingerprint: payloadFingerprint(p),
      acceptedGuestFingerprint: guestDataFingerprint(p),
      acceptedStay: stay,
    });
    expect(plan({ state: pre })).toEqual({ kind: "wait", reason: "before-registration-day" });
    expect(plan({ state: pre, today: "2026-12-20" })).toEqual({
      kind: "execute",
      operation: "convert-to-registration",
    });
    const moved = { ...stay, departureDate: "2026-12-29" };
    expect(plan({ state: pre, stay: moved })).toEqual({
      kind: "execute",
      operation: "update-pre-registration",
    });
  });

  it("registration: departure change only if documented, other changes go to staff", () => {
    const p = payloadFor();
    const reg = state({
      stage: "registered",
      transmission: "confirmed",
      externalReference: "R1",
      acceptedFingerprint: payloadFingerprint(p),
      acceptedGuestFingerprint: guestDataFingerprint(p),
      acceptedStay: stay,
    });
    const today = "2026-12-22";
    expect(plan({ state: reg, today })).toEqual({ kind: "wait", reason: "staying" });
    const longer = { ...stay, departureDate: "2026-12-29" };
    expect(plan({ state: reg, stay: longer, today })).toEqual({
      kind: "execute",
      operation: "update-departure",
    });
    expect(
      plan({
        state: reg,
        stay: longer,
        today,
        capabilities: { ...ALL, "update-departure": false },
      }),
    ).toEqual({ kind: "manual", reason: "registration-immutable" });
    const otherGuests = payloadFor(stay, [
      primary,
      { ...child, data: { ...child.data, firstName: "Benedikt" } },
    ]);
    expect(plan({ state: reg, payload: otherGuests, today })).toEqual({
      kind: "manual",
      reason: "registration-immutable",
    });
    const laterArrival = { ...stay, arrivalDate: "2026-12-21" };
    expect(plan({ state: reg, stay: laterArrival, today })).toMatchObject({ kind: "manual" });
  });

  it("check-out after departure or when the PMS says checked-out", () => {
    const p = payloadFor();
    const reg = state({
      stage: "registered",
      transmission: "confirmed",
      acceptedFingerprint: payloadFingerprint(p),
      acceptedGuestFingerprint: guestDataFingerprint(p),
      acceptedStay: stay,
    });
    expect(plan({ state: reg, today: "2026-12-28" })).toEqual({
      kind: "execute",
      operation: "check-out",
    });
    expect(
      plan({ state: reg, stay: { ...stay, status: "checked-out" }, today: "2026-12-26" }),
    ).toEqual({
      kind: "execute",
      operation: "check-out",
    });
  });

  it("cancellations", () => {
    const cancelled = { ...stay, status: "canceled" as const };
    expect(plan({ stay: cancelled })).toEqual({ kind: "done", reason: "nothing-to-transmit" });
    expect(plan({ stay: cancelled, state: state({ stage: "pre-registered" }) })).toEqual({
      kind: "execute",
      operation: "delete-pre-registration",
    });
    expect(plan({ stay: cancelled, state: state({ stage: "registered" }) })).toEqual({
      kind: "execute",
      operation: "cancel-registration",
    });
    expect(
      plan({
        stay: { ...stay, status: "no-show" },
        state: state({ stage: "registered" }),
        capabilities: { ...ALL, "cancel-registration": false },
      }),
    ).toEqual({ kind: "manual", reason: "cancelled-after-registration" });
  });

  it("without documented capabilities everything goes to staff – nothing is guessed", () => {
    expect(plan({ capabilities: NO_CAPABILITIES, today: "2026-12-20" })).toEqual({
      kind: "manual",
      reason: "not-supported",
    });
  });

  it("an unresolved creating call blocks until reconciled", () => {
    const unresolved = state({
      unresolved: {
        operation: "create-registration",
        idempotencyKey: "k",
        fingerprint: "f",
        guestFingerprint: "g",
        stay,
        at: NOW,
      },
    });
    expect(plan({ state: unresolved })).toEqual({
      kind: "execute",
      operation: "lookup-by-reference",
    });
    expect(plan({ state: unresolved, capabilities: NO_CAPABILITIES })).toEqual({
      kind: "manual",
      reason: "ambiguous-outcome",
    });
  });

  it("waits during backoff and leaves failed/manual to staff", () => {
    expect(plan({ state: state({ nextAttemptAt: new Date(NOW.getTime() + 1000) }) })).toEqual({
      kind: "wait",
      reason: "backoff",
    });
    expect(plan({ state: state({ transmission: "failed" }) })).toEqual({
      kind: "done",
      reason: "awaiting-staff",
    });
    expect(plan({ state: state({ transmission: "manual" }) })).toEqual({
      kind: "done",
      reason: "awaiting-staff",
    });
  });
});

describe("applyOutcome", () => {
  const base = { idempotencyKey: "k", fingerprint: "f", guestFingerprint: "g", stay, now: NOW };

  it("ok with reference → confirmed and accepted", () => {
    const { state: next, log } = applyOutcome({
      ...base,
      state: state(),
      operation: "create-pre-registration",
      outcome: { kind: "ok", externalReference: "R1" },
    });
    expect(next).toMatchObject({
      stage: "pre-registered",
      transmission: "confirmed",
      externalReference: "R1",
      acceptedFingerprint: "f",
      acceptedGuestFingerprint: "g",
      attempts: 0,
    });
    expect(log).toMatchObject({
      result: "ok",
      operation: "create-pre-registration",
      actor: { kind: "system" },
    });
  });

  it("ok without reference → transmitted", () => {
    expect(
      applyOutcome({
        ...base,
        state: state(),
        operation: "create-registration",
        outcome: { kind: "ok" },
      }).state.transmission,
    ).toBe("transmitted");
  });

  it("temporary errors back off and fail after the attempt limit", () => {
    const first = applyOutcome({
      ...base,
      state: state(),
      operation: "create-registration",
      outcome: { kind: "temporary", code: "unavailable" },
    }).state;
    expect(first).toMatchObject({
      attempts: 1,
      transmission: "pending",
      lastErrorCode: "unavailable",
    });
    expect(first.nextAttemptAt?.getTime()).toBe(NOW.getTime() + 60_000);
    const last = applyOutcome({
      ...base,
      state: state({ attempts: MAX_SYNC_ATTEMPTS - 1 }),
      operation: "create-registration",
      outcome: { kind: "temporary", code: "timeout" },
    }).state;
    expect(last).toMatchObject({ transmission: "failed", manualReason: "attempts-exhausted" });
  });

  it("rejected data fails at once", () => {
    expect(
      applyOutcome({
        ...base,
        state: state(),
        operation: "create-registration",
        outcome: { kind: "rejected", code: "invalid_data" },
      }).state,
    ).toMatchObject({
      transmission: "failed",
      manualReason: "rejected",
      lastErrorCode: "invalid_data",
    });
  });

  it("ambiguous creating call is remembered, never marked as done", () => {
    const next = applyOutcome({
      ...base,
      state: state(),
      operation: "create-registration",
      outcome: { kind: "ambiguous", code: "timeout" },
    }).state;
    expect(next.stage).toBe("none");
    expect(next.unresolved).toMatchObject({
      operation: "create-registration",
      idempotencyKey: "k",
      fingerprint: "f",
    });
    expect(next.lastErrorCode).toBe("ambiguous_outcome");
  });

  it("ambiguous update is retried like a temporary error", () => {
    const next = applyOutcome({
      ...base,
      state: state({ stage: "pre-registered" }),
      operation: "update-pre-registration",
      outcome: { kind: "ambiguous", code: "timeout" },
    }).state;
    expect(next.unresolved).toBeUndefined();
    expect(next.nextAttemptAt).toBeDefined();
  });

  it("lookup: found → takes over what was sent; not found → start over", () => {
    const unresolved = state({
      unresolved: {
        operation: "create-registration",
        idempotencyKey: "k",
        fingerprint: "sent",
        guestFingerprint: "sentG",
        stay,
        at: NOW,
      },
    });
    const found = applyOutcome({
      ...base,
      state: unresolved,
      operation: "lookup-by-reference",
      outcome: { kind: "ok", foundStage: "registered", externalReference: "R9" },
    }).state;
    expect(found).toMatchObject({
      stage: "registered",
      transmission: "confirmed",
      acceptedFingerprint: "sent",
      acceptedGuestFingerprint: "sentG",
    });
    expect(found.unresolved).toBeUndefined();
    const missing = applyOutcome({
      ...base,
      state: unresolved,
      operation: "lookup-by-reference",
      outcome: { kind: "ok", foundStage: "none" },
    }).state;
    expect(missing).toMatchObject({ stage: "none", transmission: "pending" });
    expect(missing.unresolved).toBeUndefined();
    expect(missing.acceptedFingerprint).toBeUndefined();
  });
});

describe("staff actions and guest card", () => {
  it("retry only from failed/manual, logged with admin id", () => {
    expect(requestRetry(state(), "adm-1", NOW)).toEqual({ ok: false, reason: "not-retryable" });
    const result = requestRetry(
      state({ transmission: "failed", attempts: 8, lastErrorCode: "invalid_data" }),
      "adm-1",
      NOW,
    );
    expect(result.ok && result.state).toMatchObject({ transmission: "pending", attempts: 0 });
    expect(result.ok && result.log.actor).toEqual({ kind: "admin", adminUserId: "adm-1" });
    expect(requestRetry(state({ transmission: "failed" }), " ", NOW)).toEqual({
      ok: false,
      reason: "admin-required",
    });
  });

  it("an ambiguous call must be resolved before a retry", () => {
    const s = state({
      transmission: "manual",
      manualReason: "ambiguous-outcome",
      unresolved: {
        operation: "create-registration",
        idempotencyKey: "k",
        fingerprint: "f",
        guestFingerprint: "g",
        stay,
        at: NOW,
      },
    });
    expect(requestRetry(s, "adm-1", NOW)).toEqual({ ok: false, reason: "resolve-ambiguity-first" });
    const resolved = resolveManually(s, {
      adminUserId: "adm-1",
      stage: "registered",
      externalReference: "WEB-7",
      now: NOW,
    });
    expect(resolved.ok && resolved.state).toMatchObject({
      stage: "registered",
      transmission: "confirmed",
      externalReference: "WEB-7",
    });
    expect(resolved.ok && resolved.state.unresolved).toBeUndefined();
  });

  it("guest card status is separate from the registration status", () => {
    const reg = state({ stage: "registered", transmission: "confirmed" });
    const failedCard = updateGuestCard(reg, "failed", { kind: "system" }, NOW).state;
    expect(failedCard.transmission).toBe("confirmed");
    expect(failedCard.stage).toBe("registered");
    const failedReg = state({ transmission: "failed", guestCard: { status: "delivered" } });
    expect(failedReg.guestCard.status).toBe("delivered");
  });

  it("a property without guest cards never gets one", () => {
    const none = initialOfficialRegistrationState({
      registrationId: REG_ID,
      tenantId: "t",
      propertyId: "p",
      target: "feratel",
      guestCardRelevant: false,
    });
    expect(none.guestCard.status).toBe("not-applicable");
    expect(updateGuestCard(none, "requested", { kind: "system" }, NOW).log.result).toBe("skipped");
    expect(guestCardAfterRegistration({ ...none, stage: "registered" }, true)).toBe(
      "not-applicable",
    );
  });

  it("derived card status: requested with e-mail, staff without", () => {
    expect(guestCardAfterRegistration(state({ stage: "pre-registered" }), true)).toBe("requested");
    expect(guestCardAfterRegistration(state({ stage: "registered" }), false)).toBe("manual");
    expect(guestCardAfterRegistration(state({ stage: "none" }), true)).toBe("waiting");
  });
});

/* ---------------------------------------------------------------------------------------- */

class FakeProvider implements OfficialRegistrationProvider {
  readonly target = "feratel" as const;
  readonly environment = "simulated" as const;
  readonly calls: OfficialRequest[] = [];
  constructor(
    readonly capabilities: ProviderCapabilities,
    private readonly answers: (ProviderOutcome | Error)[] = [],
  ) {}
  execute(request: OfficialRequest): Promise<ProviderOutcome> {
    this.calls.push(request);
    const next = this.answers.shift() ?? { kind: "ok", externalReference: "SIM-1" };
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }
}

describe("runOfficialRegistration", () => {
  const lines: string[] = [];
  const logger = createLogger({ sink: (_level, line) => lines.push(line) });
  const run = (
    provider: FakeProvider,
    s = state(),
    over: { stay?: StayFacts; today?: string } = {},
  ) =>
    runOfficialRegistration(
      { provider, now: () => NOW, logger },
      {
        state: s,
        payload: payloadFor(over.stay ?? stay),
        stay: over.stay ?? stay,
        gate: openGate,
        today: over.today ?? "2026-12-01",
        registrationDay: (over.stay ?? stay).arrivalDate,
      },
    );

  it("full lifecycle with simulated answers; card requested once pre-registered", async () => {
    const provider = new FakeProvider(ALL, [
      { kind: "ok", externalReference: "SIM-1" },
      { kind: "ok" },
      { kind: "ok" },
    ]);
    let r = await run(provider);
    expect(r.state).toMatchObject({ stage: "pre-registered", transmission: "confirmed" });
    expect(r.state.guestCard.status).toBe("requested");
    r = await run(provider, r.state, { today: "2026-12-20" });
    expect(r.state.stage).toBe("registered");
    r = await run(provider, r.state, { today: "2026-12-28" });
    expect(r.state.stage).toBe("checked-out");
    expect(provider.calls.map((call) => call.operation)).toEqual([
      "create-pre-registration",
      "convert-to-registration",
      "check-out",
    ]);
    expect(provider.calls[1]?.externalReference).toBe("SIM-1");
    // nothing more to do – no duplicate calls
    r = await run(provider, r.state, { today: "2026-12-29" });
    expect(r.plan).toEqual({ kind: "done", reason: "completed" });
    expect(provider.calls).toHaveLength(3);
  });

  it("a repeated run after success does not send again (idempotent)", async () => {
    const provider = new FakeProvider(ALL);
    const first = await run(provider);
    const second = await run(provider, first.state);
    expect(second.plan.kind).toBe("wait");
    expect(provider.calls).toHaveLength(1);
  });

  it("an adapter crash on a creating call is treated as ambiguous and reconciled, not re-sent", async () => {
    const provider = new FakeProvider(ALL, [
      new Error("boom"),
      { kind: "ok", foundStage: "pre-registered", externalReference: "SIM-5" },
    ]);
    const crashed = await run(provider);
    expect(crashed.state.unresolved?.operation).toBe("create-pre-registration");
    const later = { ...crashed.state, nextAttemptAt: new Date(NOW.getTime() - 1) };
    const reconciled = await run(provider, later);
    expect(provider.calls.map((call) => call.operation)).toEqual([
      "create-pre-registration",
      "lookup-by-reference",
    ]);
    expect(provider.calls[1]?.idempotencyKey).toBe(provider.calls[0]?.idempotencyKey);
    expect(reconciled.state).toMatchObject({ stage: "pre-registered", externalReference: "SIM-5" });
  });

  it("documented-nothing provider (real Feratel today) → staff, no call", async () => {
    const provider = new FakeProvider(NO_CAPABILITIES);
    const r = await run(provider, state(), { today: "2026-12-20" });
    expect(r.state).toMatchObject({ transmission: "manual", manualReason: "not-supported" });
    expect(r.log[0]).toMatchObject({
      operation: "handover-to-staff",
      manualReason: "not-supported",
    });
    expect(provider.calls).toHaveLength(0);
  });

  it("cancellation in Apaleo deletes the pre-registration", async () => {
    const provider = new FakeProvider(ALL, [{ kind: "ok" }]);
    const pre = state({
      stage: "pre-registered",
      transmission: "confirmed",
      externalReference: "SIM-1",
      guestCard: { status: "requested" },
    });
    const r = await run(provider, pre, { stay: { ...stay, status: "canceled" } });
    expect(provider.calls[0]?.operation).toBe("delete-pre-registration");
    expect(r.state.stage).toBe("cancelled");
  });

  it("logs ids and codes only – never guest data", async () => {
    lines.length = 0;
    await run(new FakeProvider(ALL, [{ kind: "temporary", code: "unavailable" }]));
    const text = lines.join("\n");
    expect(text).toContain(REG_ID);
    for (const value of ["Anna", "Muster", "anna@example.org", "Seestraße", "1980-05-01"]) {
      expect(text).not.toContain(value);
    }
  });
});
