import {
  attemptOtp,
  contactTargetHash,
  newOtpChallenge,
  OTP_POLICIES,
  type OtpChallenge,
} from "@up/core";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database } from "../client";
import { adminUsers, contactVerificationChallenges, contactVerificationEvents } from "../schema";
import { seedTenant } from "../seed/seed-tenant";
import { uniquePlacesSeed } from "../seed/unique-places";
import {
  createTestDatabase,
  expectConstraintViolation,
  type TestDatabase,
} from "../testing/test-database";
import {
  countTargetSends,
  listContactVerificationEvents,
  listVerificationSends,
  loadContactVerification,
  recordVerificationAttempt,
  recordVerificationChallenge,
  revokeContactWaiver,
  waiveContactVerification,
} from "./contact-verification-repository";
import {
  purgeExpiredRegistrationData,
  saveRegistrationGuests,
  startRegistration,
  submitRegistration,
} from "./registration-repository";

const PEPPER = "test-pepper-0123456789abcdef0123456789abcdef";
const up = { tenantId: "unique-places" };
const now = new Date("2026-11-06T10:00:00Z");
const email = "lea@example.org";
let db: Database;
let client: TestDatabase["client"];
let close: () => Promise<void>;
let adminId: string;
let counter = 0;

const lea = { firstName: "Lea", lastName: "Beispiel", email, phone: "+436641234567" };

async function registration() {
  counter += 1;
  const record = await startRegistration(db, up, {
    reservationProvider: "apaleo",
    externalReservationId: `CV-${String(counter)}`,
    propertyId: "hov",
    guestCount: 1,
    guestCountSource: "reservation",
    arrivalAt: new Date("2026-12-20T14:00:00Z"),
    departureAt: new Date("2026-12-27T09:00:00Z"),
  });
  await saveRegistrationGuests(db, up, record.id, 1, [{ position: 0, role: "primary", data: lea }]);
  return record.id;
}

function challengeFor(value: string, code = "123456", at = now): OtpChallenge {
  return newOtpChallenge({
    id: randomUUID(),
    channel: "email",
    targetHash: contactTargetHash(PEPPER, "email", value),
    code,
    pepper: PEPPER,
    now: at,
  });
}

beforeAll(async () => {
  ({ db, client, close } = await createTestDatabase());
  await seedTenant(db, uniquePlacesSeed);
  const [admin] = await db
    .insert(adminUsers)
    .values({ tenantId: "unique-places", email: "staff@example.org", passwordHash: "scrypt$test" })
    .returning({ id: adminUsers.id });
  adminId = admin?.id ?? "";
});

afterAll(async () => {
  await close();
});

describe("challenges", () => {
  it("stores only hashes, voids the previous pending code and feeds the send history", async () => {
    const id = await registration();
    const first = challengeFor(email);
    await recordVerificationChallenge(db, up, {
      registrationId: id,
      position: 0,
      challenge: first,
      delivery: "simulated",
    });
    const second = challengeFor(email, "654321", new Date(now.getTime() + 61_000));
    await recordVerificationChallenge(db, up, {
      registrationId: id,
      position: 0,
      challenge: second,
      delivery: "sent",
    });
    const rows = await db.select().from(contactVerificationChallenges);
    const mine = rows.filter((row) => row.registrationId === id);
    expect(mine.map((row) => row.status).sort()).toEqual(["pending", "superseded"]);
    // Nothing of the code or address in plain text.
    const dump = JSON.stringify(mine);
    expect(dump).not.toContain("123456");
    expect(dump).not.toContain(email);
    const state = await loadContactVerification(db, up, id, 0, "email");
    expect(state).toMatchObject({ value: email, latest: { id: second.id, status: "pending" } });
    expect(await listVerificationSends(db, up, id, "email", new Date(0))).toHaveLength(2);
    expect(await countTargetSends(db, up, first.targetHash, new Date(0))).toBeGreaterThanOrEqual(2);
  });

  it("keeps a failed send out of the pending state but counts it", async () => {
    const id = await registration();
    const failed = challengeFor(email);
    await recordVerificationChallenge(db, up, {
      registrationId: id,
      position: 0,
      challenge: failed,
      delivery: "failed",
    });
    const state = await loadContactVerification(db, up, id, 0, "email");
    expect(state.latest).toMatchObject({ delivery: "failed", status: "superseded" });
    expect(await listVerificationSends(db, up, id, "email", new Date(0))).toHaveLength(1);
  });

  it("verifies the current value only and records the outcome", async () => {
    const id = await registration();
    const challenge = challengeFor(email);
    await recordVerificationChallenge(db, up, {
      registrationId: id,
      position: 0,
      challenge,
      delivery: "simulated",
    });
    const wrong = attemptOtp(challenge, "000000", PEPPER, now);
    expect(
      await recordVerificationAttempt(db, up, {
        registrationId: id,
        position: 0,
        before: challenge,
        after: wrong.challenge,
        outcome: wrong.outcome,
        currentTargetHash: challenge.targetHash,
        now,
      }),
    ).toBe("ok");
    // A second entry checked against the old state loses (no double use of one attempt).
    expect(
      await recordVerificationAttempt(db, up, {
        registrationId: id,
        position: 0,
        before: challenge,
        after: wrong.challenge,
        outcome: wrong.outcome,
        currentTargetHash: challenge.targetHash,
        now,
      }),
    ).toBe("conflict");
    const right = attemptOtp(wrong.challenge, "123456", PEPPER, now);
    expect(right.outcome).toBe("verified");
    // Value changed meanwhile → no verification of the new value.
    expect(
      await recordVerificationAttempt(db, up, {
        registrationId: id,
        position: 0,
        before: wrong.challenge,
        after: right.challenge,
        outcome: right.outcome,
        currentTargetHash: contactTargetHash(PEPPER, "email", "other@example.org"),
        now,
      }),
    ).toBe("conflict");
    expect(
      await recordVerificationAttempt(db, up, {
        registrationId: id,
        position: 0,
        before: wrong.challenge,
        after: right.challenge,
        outcome: right.outcome,
        currentTargetHash: challenge.targetHash,
        now,
      }),
    ).toBe("ok");
    const state = await loadContactVerification(db, up, id, 0, "email");
    expect(state).toMatchObject({ verifiedHash: challenge.targetHash, verifiedAt: now });
    const events = (await listContactVerificationEvents(db, up, id)).map((row) => row.event);
    expect(events).toEqual(["code-simulated", "code-wrong", "verified"]);
  });

  it("voids verification, waiver and pending codes when the guest changes the value", async () => {
    const id = await registration();
    const challenge = challengeFor(email);
    await recordVerificationChallenge(db, up, {
      registrationId: id,
      position: 0,
      challenge,
      delivery: "simulated",
    });
    const right = attemptOtp(challenge, "123456", PEPPER, now);
    await recordVerificationAttempt(db, up, {
      registrationId: id,
      position: 0,
      before: challenge,
      after: right.challenge,
      outcome: right.outcome,
      currentTargetHash: challenge.targetHash,
      now,
    });
    // Unchanged save keeps the confirmation.
    await saveRegistrationGuests(db, up, id, 2, [{ position: 0, role: "primary", data: lea }]);
    expect((await loadContactVerification(db, up, id, 0, "email")).verifiedAt).toEqual(now);
    await waiveContactVerification(db, up, {
      registrationId: id,
      position: 0,
      channel: "sms",
      waiver: { adminUserId: adminId, reason: "guest-has-no-reachable-mobile", at: now },
    });
    const pending = challengeFor(email, "111111", new Date(now.getTime() + 120_000));
    await recordVerificationChallenge(db, up, {
      registrationId: id,
      position: 0,
      challenge: { ...pending, channel: "sms" },
      delivery: "simulated",
    });
    await saveRegistrationGuests(db, up, id, 3, [
      {
        position: 0,
        role: "primary",
        data: { ...lea, email: "lea.neu@example.org", phone: "+491701234567" },
      },
    ]);
    const after = await loadContactVerification(db, up, id, 0, "email");
    expect(after.verifiedAt).toBeUndefined();
    const sms = await loadContactVerification(db, up, id, 0, "sms");
    expect(sms.waiver).toBeUndefined();
    expect(sms.latest?.status).toBe("superseded");
    const events = (await listContactVerificationEvents(db, up, id)).map(
      (row) => `${row.channel}:${row.event}`,
    );
    expect(events).toContain("email:reset-by-change");
    expect(events).toContain("sms:reset-by-change");
  });
});

describe("staff waiver", () => {
  it("is documented with admin, reason and event; 'other' needs a note", async () => {
    const id = await registration();
    expect(
      await waiveContactVerification(db, up, {
        registrationId: id,
        position: 0,
        channel: "email",
        waiver: { adminUserId: adminId, reason: "delivery-failed", at: now },
      }),
    ).toBe("ok");
    expect((await loadContactVerification(db, up, id, 0, "email")).waiver).toEqual({
      adminUserId: adminId,
      reason: "delivery-failed",
      at: now,
    });
    await expect(
      waiveContactVerification(db, up, {
        registrationId: id,
        position: 0,
        channel: "email",
        waiver: { adminUserId: adminId, reason: "other", at: now },
      }),
    ).rejects.toThrow();
    expect(
      await revokeContactWaiver(db, up, {
        registrationId: id,
        position: 0,
        channel: "email",
        adminUserId: adminId,
        now,
      }),
    ).toBe("ok");
    expect((await loadContactVerification(db, up, id, 0, "email")).waiver).toBeUndefined();
    const events = await listContactVerificationEvents(db, up, id);
    expect(events.map((row) => row.event)).toEqual(["waived", "waiver-revoked"]);
    expect(events[0]).toMatchObject({ actor: "admin", adminUserId: adminId });
  });

  it("is refused for other tenants and unknown check-ins", async () => {
    const id = await registration();
    expect(
      await waiveContactVerification(
        db,
        { tenantId: "other-tenant" },
        {
          registrationId: id,
          position: 0,
          channel: "email",
          waiver: { adminUserId: adminId, reason: "delivery-failed", at: now },
        },
      ),
    ).toBe("not-found");
  });
});

describe("database rules", () => {
  it("keeps the audit trail append-only and checks hashes and waivers", async () => {
    const id = await registration();
    await waiveContactVerification(db, up, {
      registrationId: id,
      position: 0,
      channel: "email",
      waiver: { adminUserId: adminId, reason: "confirmed-in-person", at: now },
    });
    await expect(
      client.query(
        `UPDATE contact_verification_events SET event = 'verified' WHERE registration_id = '${id}'`,
      ),
    ).rejects.toThrow(/append-only/);
    await expectConstraintViolation(
      db.insert(contactVerificationChallenges).values({
        id: randomUUID(),
        tenantId: "unique-places",
        registrationId: id,
        channel: "email",
        targetHash: "not-a-hash",
        codeHash: "0".repeat(64),
        delivery: "sent",
        expiresAt: now,
      }),
      "contact_verification_challenges_target_hash_format",
    );
    await expectConstraintViolation(
      client.query(
        `UPDATE guest_registration_contacts SET email_waiver_reason = 'other', email_waiver_note = NULL WHERE registration_id = '${id}'`,
      ),
      "guest_registration_contacts_email_waiver_valid",
    );
    await expectConstraintViolation(
      db.insert(contactVerificationEvents).values({
        tenantId: "unique-places",
        registrationId: id,
        channel: "email",
        event: "waived",
        actor: "admin",
        occurredAt: now,
      }),
      "contact_verification_events_actor_consistent",
    );
    expect(OTP_POLICIES.email.maxAttempts).toBe(5);
  });

  it("removes code challenges with the contact data at its retention date", async () => {
    const id = await registration();
    await recordVerificationChallenge(db, up, {
      registrationId: id,
      position: 0,
      challenge: challengeFor(email),
      delivery: "simulated",
    });
    await submitRegistration(db, up, id, {
      expectedVersion: 2,
      targets: [],
      now,
      purgeAfter: new Date("2027-01-26T09:00:00Z"),
      contactPurgeAfter: new Date("2027-01-03T09:00:00Z"),
    });
    await purgeExpiredRegistrationData(db, new Date("2027-01-04T00:00:00Z"));
    const left = (await db.select().from(contactVerificationChallenges)).filter(
      (row) => row.registrationId === id,
    );
    expect(left).toEqual([]);
    // The audit events (no contact data) remain.
    expect((await listContactVerificationEvents(db, up, id)).length).toBeGreaterThan(0);
  });
});
