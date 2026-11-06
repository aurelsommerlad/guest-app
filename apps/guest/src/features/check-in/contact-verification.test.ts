/**
 * E-mail verification in the check-in (ADR 0021, C4) against the real repository (PGlite),
 * with the simulated sender: nothing leaves the process.
 */
import {
  DEFAULT_CHECK_IN_VALIDATION_POLICY,
  type MessageSendResult,
  type PropertyRegistrationConfig,
  type VerificationEmailSender,
} from "@up/core";
import {
  type Database,
  getRegistrationForReservation,
  listContactVerificationEvents,
  saveJourneySettings,
  schema,
  seedTenant,
  uniquePlacesSeed,
  waiveContactVerification,
} from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { SimulatedEmailSender, SimulatedSmsSender, VerificationOutbox } from "@up/integrations";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkInAvailability, confirmTrip, saveGuestStep, submitCheckIn } from "./check-in-service";
import {
  confirmVerificationCode,
  contactVerificationView,
  sendCodeIfDue,
  sendVerificationCode,
  type VerificationDeps,
} from "./contact-verification-service";
import { reviewStatusRows } from "./review-status";
import {
  BEFORE_ARRIVAL,
  capturingLogger,
  guestContext,
  testRegistrationConfig,
} from "./test-context";

const PEPPER = "local-test-pepper-0123456789abcdef0123456789";
const up = { tenantId: "unique-places" };
const access = {
  mode: "manual" as const,
  release: "arrival-day" as const,
  requiresCompletedRegistration: false,
};
const policy = {
  ...DEFAULT_CHECK_IN_VALIDATION_POLICY,
  addressSuggestions: "off" as const,
  companyBilling: false,
};
const config: PropertyRegistrationConfig = {
  ...testRegistrationConfig,
  targets: [],
  validation: policy,
};
const laura = {
  firstName: "Laura",
  lastName: "Muster",
  email: "laura.muster@example.com",
  phone: "+49 170 1234567",
  birthDate: "1990-05-17",
  nationality: "DE",
};
const address = { street: "Seeweg 3", postalCode: "88131", city: "Lindau", country: "DE" };
const context = guestContext({ guestCount: { adults: 1, children: 0 } });

let test: TestDatabase;
let db: Database;
let lines: string[];
let clock: Date;
let outbox: VerificationOutbox;
let deps: VerificationDeps;

function withSender(
  sender: VerificationEmailSender | undefined,
  mode: "simulated" | "off" = "simulated",
) {
  return { ...deps, email: { mode, ...(sender ? { sender } : {}) } } satisfies VerificationDeps;
}

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  await seedTenant(db, uniquePlacesSeed);
  await saveJourneySettings(db, up, "hov", { registration: config, access });
  const captured = capturingLogger();
  lines = captured.lines;
  clock = BEFORE_ARRIVAL;
  outbox = new VerificationOutbox();
  deps = {
    db,
    logger: captured.logger,
    now: () => clock,
    pepper: PEPPER,
    email: { mode: "simulated", sender: new SimulatedEmailSender(outbox) },
    sms: { mode: "off" },
  };
  deps.verificationGate = async (ctx, journey) =>
    (await contactVerificationView(deps, ctx, journey, "email")).blocksSubmit ? "blocked" : "ok";
  await confirmTrip(deps, context);
  await saveGuestStep(deps, context, { step: "guests", version: 1, values: { 0: laura } });
  await saveGuestStep(deps, context, { step: "address", version: 2, values: { 0: address } });
});

afterEach(async () => {
  await test.close();
});

async function journey() {
  const availability = await checkInAvailability(deps, context);
  if (!availability.available) throw new Error(availability.reason);
  return availability.journey;
}

async function view() {
  return contactVerificationView(deps, context, await journey(), "email");
}

async function version() {
  const record = await getRegistrationForReservation(db, context, {
    reservationProvider: context.reservationProvider,
    externalReservationId: context.externalReservationId,
  });
  return record?.version ?? 0;
}

function lastCode(): string {
  const entry = outbox.latest("email", laura.email);
  if (!entry) throw new Error("no code in outbox");
  return entry.message.code;
}

function later(ms: number) {
  clock = new Date(clock.getTime() + ms);
}

describe("sending and confirming", () => {
  it("confirms the main guest's e-mail with the code and only then allows the submit", async () => {
    expect(await view()).toMatchObject({
      required: true,
      offered: true,
      status: "none",
      blocksSubmit: true,
    });
    expect(
      await submitCheckIn(deps, context, { version: await version(), confirmed: true }),
    ).toEqual({
      ok: false,
      reason: "contact-not-verified",
    });
    expect(await sendVerificationCode(deps, context, { channel: "email", locale: "de" })).toEqual({
      ok: true,
      simulated: true,
    });
    const sent = outbox.latest("email", laura.email)?.message;
    expect(sent).toMatchObject({ locale: "de", propertyName: "HØV", validMinutes: 10 });
    expect(await view()).toMatchObject({ status: "pending", pending: { attemptsLeft: 5 } });

    const wrong = lastCode() === "000000" ? "000001" : "000000";
    expect(await confirmVerificationCode(deps, context, { channel: "email", code: wrong })).toEqual(
      {
        ok: false,
        reason: "wrong-code",
        attemptsLeft: 4,
      },
    );
    expect(
      await confirmVerificationCode(deps, context, {
        channel: "email",
        code: ` ${lastCode().slice(0, 3)} ${lastCode().slice(3)} `,
      }),
    ).toEqual({ ok: true });
    expect(await view()).toMatchObject({ status: "verified", blocksSubmit: false });
    expect(
      await submitCheckIn(deps, context, { version: await version(), confirmed: true }),
    ).toMatchObject({
      ok: true,
    });
    // Separate from the check-in status: the confirmation lives with the contact.
    const [contact] = await db.select().from(schema.guestRegistrationContacts);
    expect(contact?.emailVerifiedAt).toEqual(clock);
    // Nothing personal and no code in the logs.
    const log = lines.join("\n");
    expect(log).not.toContain(laura.email);
    expect(log).not.toContain(lastCode());
  });

  it("expires codes after 10 minutes and locks them after 5 wrong attempts", async () => {
    await sendVerificationCode(deps, context, { channel: "email", locale: "en" });
    later(10 * 60_000 + 1);
    expect(
      await confirmVerificationCode(deps, context, { channel: "email", code: lastCode() }),
    ).toEqual({
      ok: false,
      reason: "expired",
    });
    await sendVerificationCode(deps, context, { channel: "email", locale: "en" });
    const wrong = lastCode() === "111111" ? "222222" : "111111";
    for (let i = 0; i < 4; i++) {
      await confirmVerificationCode(deps, context, { channel: "email", code: wrong });
    }
    expect(await confirmVerificationCode(deps, context, { channel: "email", code: wrong })).toEqual(
      {
        ok: false,
        reason: "locked",
      },
    );
    // Even the right code no longer works once locked.
    expect(
      await confirmVerificationCode(deps, context, { channel: "email", code: lastCode() }),
    ).toEqual({
      ok: false,
      reason: "locked",
    });
    expect(await view()).toMatchObject({ status: "locked", blocksSubmit: true });
    // A new code (after the cooldown) works again; the check-in data is untouched.
    later(61_000);
    expect(
      await sendVerificationCode(deps, context, { channel: "email", locale: "en" }),
    ).toMatchObject({ ok: true });
    expect(
      await confirmVerificationCode(deps, context, { channel: "email", code: lastCode() }),
    ).toEqual({ ok: true });
    const record = (await journey()).registration;
    expect(record?.guests[0]?.data).toMatchObject({ firstName: "Laura", street: "Seeweg 3" });
  });

  it("enforces the resend cooldown and the daily send limit", async () => {
    await sendVerificationCode(deps, context, { channel: "email", locale: "de" });
    const early = await sendVerificationCode(deps, context, { channel: "email", locale: "de" });
    expect(early).toMatchObject({ ok: false, reason: "cooldown" });
    if (!early.ok) expect(early.retryAt?.getTime()).toBe(clock.getTime() + 60_000);
    for (let i = 0; i < 4; i++) {
      later(61_000);
      expect(
        await sendVerificationCode(deps, context, { channel: "email", locale: "de" }),
      ).toMatchObject({ ok: true });
    }
    later(61_000);
    expect(
      await sendVerificationCode(deps, context, { channel: "email", locale: "de" }),
    ).toMatchObject({
      ok: false,
      reason: "send-limit",
    });
    // A newer code replaces the older one.
    expect(outbox.size).toBe(5);
  });

  it("asks again after the guest changes the address", async () => {
    await sendVerificationCode(deps, context, { channel: "email", locale: "de" });
    await confirmVerificationCode(deps, context, { channel: "email", code: lastCode() });
    expect((await view()).status).toBe("verified");
    later(61_000);
    await sendVerificationCode(deps, context, { channel: "email", locale: "de" }); // already verified
    await saveGuestStep(deps, context, {
      step: "guests",
      version: await version(),
      values: { 0: { ...laura, email: "laura.neu@example.com" } },
    });
    expect(await view()).toMatchObject({
      status: "none",
      blocksSubmit: true,
      masked: "l•••@example.com",
    });
    expect(
      await confirmVerificationCode(deps, context, { channel: "email", code: lastCode() }),
    ).toMatchObject({
      ok: false,
    });
  });
});

describe("failures and the manual alternative", () => {
  it("records a failed delivery without losing check-in data", async () => {
    const failing: VerificationEmailSender = {
      sendVerificationCode: (): Promise<MessageSendResult> =>
        Promise.resolve({ ok: false, reason: "unavailable" }),
    };
    expect(
      await sendVerificationCode(withSender(failing), context, { channel: "email", locale: "de" }),
    ).toEqual({ ok: false, reason: "delivery-failed" });
    const record = await journey();
    expect(record.assessment.readyToSubmit).toBe(true);
    expect(await view()).toMatchObject({ status: "none" });
    const events = await listContactVerificationEvents(db, up, record.registration?.id ?? "");
    expect(events.map((event) => event.event)).toContain("code-send-failed");
  });

  it("does not block when no sender is active – the status stays unconfirmed", async () => {
    const off = withSender(undefined, "off");
    off.verificationGate = async (ctx, j) =>
      (await contactVerificationView(off, ctx, j, "email")).blocksSubmit ? "blocked" : "ok";
    expect(await contactVerificationView(off, context, await journey(), "email")).toMatchObject({
      offered: false,
      blocksSubmit: false,
      status: "none",
    });
    expect(await sendVerificationCode(off, context, { channel: "email", locale: "de" })).toEqual({
      ok: false,
      reason: "not-offered",
    });
    expect(
      await submitCheckIn(off, context, { version: await version(), confirmed: true }),
    ).toMatchObject({
      ok: true,
    });
    // Never shown as confirmed.
    const rows = reviewStatusRows(await journey(), { email: "none" });
    expect(rows.find((row) => row.id === "email")?.value).toBe("email.pending");
  });

  it("accepts a documented staff waiver instead of the code", async () => {
    const [admin] = await db
      .insert(schema.adminUsers)
      .values({
        tenantId: "unique-places",
        email: "staff@example.org",
        passwordHash: "scrypt$test",
      })
      .returning({ id: schema.adminUsers.id });
    const registrationId = (await journey()).registration?.id ?? "";
    await waiveContactVerification(db, up, {
      registrationId,
      position: 0,
      channel: "email",
      waiver: { adminUserId: admin?.id ?? "", reason: "guest-has-no-own-email", at: clock },
    });
    expect(await view()).toMatchObject({ status: "waived", blocksSubmit: false });
    expect(
      await submitCheckIn(deps, context, { version: await version(), confirmed: true }),
    ).toMatchObject({
      ok: true,
    });
    const rows = reviewStatusRows(await journey(), { email: "waived" });
    expect(rows.find((row) => row.id === "email")?.value).toBe("email.waived");
  });

  it("sends the first code automatically once after the e-mail was saved", async () => {
    await sendCodeIfDue(deps, context, await journey(), "de");
    await sendCodeIfDue(deps, context, await journey(), "de");
    expect(outbox.size).toBe(1);
  });
});

describe("SMS (C5, prepared – simulated only)", () => {
  async function smsDeps(supportedCountries: string[]) {
    await saveJourneySettings(db, up, "hov", {
      registration: {
        ...config,
        validation: {
          ...policy,
          smsVerification: { mode: "optional", supportedCountries },
        },
      },
      access,
    });
    return {
      ...deps,
      sms: { mode: "simulated" as const, sender: new SimulatedSmsSender(outbox) },
    } satisfies VerificationDeps;
  }

  it("is off by default: an entered number reads 'no SMS confirmation'", async () => {
    expect(await contactVerificationView(deps, context, await journey(), "sms")).toMatchObject({
      offered: false,
      status: "disabled",
      required: false,
      blocksSubmit: false,
    });
  });

  it("confirms a supported mobile number with the stricter SMS limits", async () => {
    const sms = await smsDeps(["DE", "AT", "CH"]);
    expect(
      await sendVerificationCode(sms, context, { channel: "sms", locale: "de" }),
    ).toMatchObject({
      ok: true,
    });
    const code = outbox.latest("sms", "+491701234567")?.message.code ?? "";
    expect(await confirmVerificationCode(sms, context, { channel: "sms", code })).toEqual({
      ok: true,
    });
    expect(await contactVerificationView(sms, context, await journey(), "sms")).toMatchObject({
      status: "verified",
    });
    // Cooldown 90 s for SMS.
    later(61_000);
    await saveGuestStep(sms, context, {
      step: "guests",
      version: await version(),
      values: { 0: { ...laura, phone: "+49 170 7654321" } },
    });
    expect(
      await sendVerificationCode(sms, context, { channel: "sms", locale: "de" }),
    ).toMatchObject({
      ok: false,
      reason: "cooldown",
    });
  });

  it("never offers SMS to unsupported countries and never blocks because of it", async () => {
    const sms = await smsDeps(["AT"]);
    expect(await contactVerificationView(sms, context, await journey(), "sms")).toMatchObject({
      offered: false,
      status: "unsupported-country",
      blocksSubmit: false,
    });
    expect(await sendVerificationCode(sms, context, { channel: "sms", locale: "de" })).toEqual({
      ok: false,
      reason: "not-offered",
    });
  });

  it("accepts the staff exception for guests without a reachable mobile number", async () => {
    const sms = await smsDeps(["DE"]);
    const [admin] = await db
      .insert(schema.adminUsers)
      .values({ tenantId: "unique-places", email: "desk@example.org", passwordHash: "scrypt$test" })
      .returning({ id: schema.adminUsers.id });
    await waiveContactVerification(db, up, {
      registrationId: (await journey()).registration?.id ?? "",
      position: 0,
      channel: "sms",
      waiver: { adminUserId: admin?.id ?? "", reason: "guest-has-no-reachable-mobile", at: clock },
    });
    expect(await contactVerificationView(sms, context, await journey(), "sms")).toMatchObject({
      status: "waived",
    });
  });
});
