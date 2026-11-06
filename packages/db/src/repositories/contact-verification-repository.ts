/**
 * Persistence of contact verification (ADR 0021, C4/C5): one-time code challenges (hashes
 * only), the confirmed value per contact (HMAC of the value) and documented staff waivers,
 * each with an audit event. Stored apart from the check-in status: a failed or locked code
 * never touches the registration data.
 */
import {
  type ContactWaiver,
  contactWaiverSchema,
  isEntityKey,
  MAX_TRAVELLERS,
  type OtpAttemptOutcome,
  type OtpChallenge,
  type OtpChannel,
  type OtpSend,
  type TenantContext,
  type VerificationDelivery,
} from "@up/core";
import { and, desc, eq, gt, sql } from "drizzle-orm";

import { type Database } from "../client";
import {
  contactVerificationChallenges,
  contactVerificationEvents,
  guestRegistrationContacts,
  guestRegistrations,
} from "../schema";

function assertTenantContext(context: TenantContext): void {
  if (!isEntityKey(context.tenantId)) throw new TypeError("Invalid tenant context");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertKey(registrationId: string, position: number) {
  if (!UUID.test(registrationId)) throw new RangeError("Invalid registration id");
  if (!Number.isInteger(position) || position < 0 || position >= MAX_TRAVELLERS) {
    throw new RangeError("Invalid guest position");
  }
}

export type StoredChallenge = OtpChallenge & { delivery: VerificationDelivery };

export type ContactVerificationState = {
  /** Current stored value (normalised e-mail / E.164). */
  value?: string;
  verifiedHash?: string;
  verifiedAt?: Date;
  waiver?: ContactWaiver;
  /** The newest challenge of this channel (any status). */
  latest?: StoredChallenge;
};

function toChallenge(row: typeof contactVerificationChallenges.$inferSelect): StoredChallenge {
  return {
    id: row.id,
    channel: row.channel,
    targetHash: row.targetHash,
    codeHash: row.codeHash,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    attempts: row.attempts,
    status: row.status,
    delivery: row.delivery,
    ...(row.verifiedAt ? { verifiedAt: row.verifiedAt } : {}),
  };
}

const COLUMNS = {
  email: {
    value: guestRegistrationContacts.email,
    verifiedAt: guestRegistrationContacts.emailVerifiedAt,
    verifiedHash: guestRegistrationContacts.emailVerifiedHash,
    waivedAt: guestRegistrationContacts.emailWaivedAt,
    waivedBy: guestRegistrationContacts.emailWaivedBy,
    reason: guestRegistrationContacts.emailWaiverReason,
    note: guestRegistrationContacts.emailWaiverNote,
  },
  sms: {
    value: guestRegistrationContacts.phone,
    verifiedAt: guestRegistrationContacts.phoneVerifiedAt,
    verifiedHash: guestRegistrationContacts.phoneVerifiedHash,
    waivedAt: guestRegistrationContacts.phoneWaivedAt,
    waivedBy: guestRegistrationContacts.phoneWaivedBy,
    reason: guestRegistrationContacts.phoneWaiverReason,
    note: guestRegistrationContacts.phoneWaiverNote,
  },
} as const;

function contactKey(context: TenantContext, registrationId: string, position: number) {
  return and(
    eq(guestRegistrationContacts.tenantId, context.tenantId),
    eq(guestRegistrationContacts.registrationId, registrationId),
    eq(guestRegistrationContacts.position, position),
  );
}

function challengeKey(
  context: TenantContext,
  registrationId: string,
  position: number,
  channel: OtpChannel,
) {
  return and(
    eq(contactVerificationChallenges.tenantId, context.tenantId),
    eq(contactVerificationChallenges.registrationId, registrationId),
    eq(contactVerificationChallenges.position, position),
    eq(contactVerificationChallenges.channel, channel),
  );
}

export async function loadContactVerification(
  db: Database,
  context: TenantContext,
  registrationId: string,
  position: number,
  channel: OtpChannel,
): Promise<ContactVerificationState> {
  assertTenantContext(context);
  assertKey(registrationId, position);
  const columns = COLUMNS[channel];
  const [contact] = await db
    .select({
      value: columns.value,
      verifiedAt: columns.verifiedAt,
      verifiedHash: columns.verifiedHash,
      waivedAt: columns.waivedAt,
      waivedBy: columns.waivedBy,
      reason: columns.reason,
      note: columns.note,
    })
    .from(guestRegistrationContacts)
    .where(contactKey(context, registrationId, position));
  const [latest] = await db
    .select()
    .from(contactVerificationChallenges)
    .where(challengeKey(context, registrationId, position, channel))
    .orderBy(desc(contactVerificationChallenges.createdAt))
    .limit(1);
  return {
    ...(contact?.value ? { value: contact.value } : {}),
    ...(contact?.verifiedAt && contact.verifiedHash
      ? { verifiedAt: contact.verifiedAt, verifiedHash: contact.verifiedHash }
      : {}),
    ...(contact?.waivedAt && contact.waivedBy && contact.reason
      ? {
          waiver: {
            adminUserId: contact.waivedBy,
            reason: contact.reason,
            at: contact.waivedAt,
            ...(contact.note ? { note: contact.note } : {}),
          },
        }
      : {}),
    ...(latest ? { latest: toChallenge(latest) } : {}),
  };
}

/** Earlier sends of this check-in and channel since `since` (input for `canIssueOtp`). */
export async function listVerificationSends(
  db: Database,
  context: TenantContext,
  registrationId: string,
  channel: OtpChannel,
  since: Date,
): Promise<OtpSend[]> {
  assertTenantContext(context);
  const rows = await db
    .select({
      sentAt: contactVerificationChallenges.createdAt,
      targetHash: contactVerificationChallenges.targetHash,
    })
    .from(contactVerificationChallenges)
    .where(
      and(
        eq(contactVerificationChallenges.tenantId, context.tenantId),
        eq(contactVerificationChallenges.registrationId, registrationId),
        eq(contactVerificationChallenges.channel, channel),
        gt(contactVerificationChallenges.createdAt, since),
      ),
    );
  return rows;
}

/** Sends to one target (address / number) across all check-ins of the tenant – anti-bombing. */
export async function countTargetSends(
  db: Database,
  context: TenantContext,
  targetHash: string,
  since: Date,
): Promise<number> {
  assertTenantContext(context);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contactVerificationChallenges)
    .where(
      and(
        eq(contactVerificationChallenges.tenantId, context.tenantId),
        eq(contactVerificationChallenges.targetHash, targetHash),
        gt(contactVerificationChallenges.createdAt, since),
      ),
    );
  return row?.count ?? 0;
}

const SEND_EVENTS = {
  sent: "code-sent",
  simulated: "code-simulated",
  failed: "code-send-failed",
} as const;

/**
 * Stores a new challenge (after the send attempt) and voids any pending one of the same
 * contact and channel. A failed send is kept – it counts against the limits – but is never
 * pending.
 */
export async function recordVerificationChallenge(
  db: Database,
  context: TenantContext,
  input: {
    registrationId: string;
    position: number;
    challenge: OtpChallenge;
    delivery: VerificationDelivery;
  },
): Promise<void> {
  assertTenantContext(context);
  assertKey(input.registrationId, input.position);
  const { challenge } = input;
  await db.transaction(async (tx) => {
    await tx
      .update(contactVerificationChallenges)
      .set({ status: "superseded", updatedAt: challenge.createdAt })
      .where(
        and(
          challengeKey(context, input.registrationId, input.position, challenge.channel),
          eq(contactVerificationChallenges.status, "pending"),
        ),
      );
    await tx.insert(contactVerificationChallenges).values({
      id: challenge.id,
      tenantId: context.tenantId,
      registrationId: input.registrationId,
      position: input.position,
      channel: challenge.channel,
      targetHash: challenge.targetHash,
      codeHash: challenge.codeHash,
      status: input.delivery === "failed" ? "superseded" : "pending",
      attempts: 0,
      delivery: input.delivery,
      expiresAt: challenge.expiresAt,
      createdAt: challenge.createdAt,
      updatedAt: challenge.createdAt,
    });
    await tx.insert(contactVerificationEvents).values({
      tenantId: context.tenantId,
      registrationId: input.registrationId,
      position: input.position,
      channel: challenge.channel,
      event: SEND_EVENTS[input.delivery],
      actor: "guest",
      challengeId: challenge.id,
      occurredAt: challenge.createdAt,
    });
  });
}

const ATTEMPT_EVENTS = {
  verified: "verified",
  "wrong-code": "code-wrong",
  expired: "code-expired",
  locked: "code-locked",
} as const;

/**
 * Persists one code entry. Optimistic: only applies if the challenge is still in the state the
 * entry was checked against (parallel entries cannot both use the same attempt). On success
 * the confirmed value's hash is stored with the contact – only if the contact still holds the
 * value the code was sent to.
 */
export async function recordVerificationAttempt(
  db: Database,
  context: TenantContext,
  input: {
    registrationId: string;
    position: number;
    before: OtpChallenge;
    after: OtpChallenge;
    outcome: OtpAttemptOutcome;
    /** HMAC of the contact's current value – must equal the challenge's target to verify. */
    currentTargetHash: string | undefined;
    now: Date;
  },
): Promise<"ok" | "conflict"> {
  assertTenantContext(context);
  assertKey(input.registrationId, input.position);
  if (input.outcome === "not-pending") return "ok";
  const { before, after } = input;
  if (input.outcome === "verified" && input.currentTargetHash !== before.targetHash) {
    return "conflict";
  }
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(contactVerificationChallenges)
      .set({
        status: after.status,
        attempts: after.attempts,
        verifiedAt: after.verifiedAt ?? null,
        updatedAt: input.now,
      })
      .where(
        and(
          challengeKey(context, input.registrationId, input.position, before.channel),
          eq(contactVerificationChallenges.id, before.id),
          eq(contactVerificationChallenges.status, "pending"),
          eq(contactVerificationChallenges.attempts, before.attempts),
        ),
      )
      .returning({ id: contactVerificationChallenges.id });
    if (updated.length === 0) return "conflict" as const;
    if (input.outcome === "verified") {
      const columns = COLUMNS[before.channel];
      const result = await tx
        .update(guestRegistrationContacts)
        .set({
          [before.channel === "email" ? "emailVerifiedAt" : "phoneVerifiedAt"]: input.now,
          [before.channel === "email" ? "emailVerifiedHash" : "phoneVerifiedHash"]:
            before.targetHash,
          updatedAt: input.now,
        })
        .where(and(contactKey(context, input.registrationId, input.position)))
        .returning({ value: columns.value });
      if (result.length === 0) throw new Error("contact missing for a verified challenge");
    }
    await tx.insert(contactVerificationEvents).values({
      tenantId: context.tenantId,
      registrationId: input.registrationId,
      position: input.position,
      channel: before.channel,
      event: ATTEMPT_EVENTS[input.outcome as keyof typeof ATTEMPT_EVENTS],
      actor: "guest",
      challengeId: before.id,
      occurredAt: input.now,
    });
    return "ok" as const;
  });
}

async function registrationExists(db: Database, context: TenantContext, registrationId: string) {
  const [row] = await db
    .select({ id: guestRegistrations.id })
    .from(guestRegistrations)
    .where(
      and(
        eq(guestRegistrations.tenantId, context.tenantId),
        eq(guestRegistrations.id, registrationId),
      ),
    );
  return row !== undefined;
}

/**
 * Documented staff exception (C4/C5): an admin waives the code for this contact – e.g. the
 * guest has no own e-mail or no reachable mobile number. Counts as "waived", never as
 * "verified"; voided when the guest changes the value.
 */
export async function waiveContactVerification(
  db: Database,
  context: TenantContext,
  input: { registrationId: string; position: number; channel: OtpChannel; waiver: ContactWaiver },
): Promise<"ok" | "not-found"> {
  assertTenantContext(context);
  assertKey(input.registrationId, input.position);
  const waiver = contactWaiverSchema.parse(input.waiver);
  if (!UUID.test(waiver.adminUserId)) throw new RangeError("Invalid admin user id");
  if (!(await registrationExists(db, context, input.registrationId))) return "not-found";
  const set =
    input.channel === "email"
      ? {
          emailWaivedAt: waiver.at,
          emailWaivedBy: waiver.adminUserId,
          emailWaiverReason: waiver.reason,
          emailWaiverNote: waiver.note ?? null,
        }
      : {
          phoneWaivedAt: waiver.at,
          phoneWaivedBy: waiver.adminUserId,
          phoneWaiverReason: waiver.reason,
          phoneWaiverNote: waiver.note ?? null,
        };
  await db.transaction(async (tx) => {
    await tx
      .insert(guestRegistrationContacts)
      .values({
        tenantId: context.tenantId,
        registrationId: input.registrationId,
        position: input.position,
        ...set,
      })
      .onConflictDoUpdate({
        target: [guestRegistrationContacts.registrationId, guestRegistrationContacts.position],
        set: { ...set, updatedAt: waiver.at },
      });
    await tx.insert(contactVerificationEvents).values({
      tenantId: context.tenantId,
      registrationId: input.registrationId,
      position: input.position,
      channel: input.channel,
      event: "waived",
      actor: "admin",
      adminUserId: waiver.adminUserId,
      waiverReason: waiver.reason,
      occurredAt: waiver.at,
    });
  });
  return "ok";
}

export async function revokeContactWaiver(
  db: Database,
  context: TenantContext,
  input: {
    registrationId: string;
    position: number;
    channel: OtpChannel;
    adminUserId: string;
    now: Date;
  },
): Promise<"ok" | "not-found"> {
  assertTenantContext(context);
  assertKey(input.registrationId, input.position);
  if (!UUID.test(input.adminUserId)) throw new RangeError("Invalid admin user id");
  const set =
    input.channel === "email"
      ? { emailWaivedAt: null, emailWaivedBy: null, emailWaiverReason: null, emailWaiverNote: null }
      : {
          phoneWaivedAt: null,
          phoneWaivedBy: null,
          phoneWaiverReason: null,
          phoneWaiverNote: null,
        };
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(guestRegistrationContacts)
      .set({ ...set, updatedAt: input.now })
      .where(contactKey(context, input.registrationId, input.position))
      .returning({ id: guestRegistrationContacts.id });
    if (updated.length === 0) return "not-found" as const;
    await tx.insert(contactVerificationEvents).values({
      tenantId: context.tenantId,
      registrationId: input.registrationId,
      position: input.position,
      channel: input.channel,
      event: "waiver-revoked",
      actor: "admin",
      adminUserId: input.adminUserId,
      occurredAt: input.now,
    });
    return "ok" as const;
  });
}

/** Audit trail of one check-in (for the admin and tests): events only, no values. */
export async function listContactVerificationEvents(
  db: Database,
  context: TenantContext,
  registrationId: string,
) {
  assertTenantContext(context);
  return db
    .select({
      position: contactVerificationEvents.position,
      channel: contactVerificationEvents.channel,
      event: contactVerificationEvents.event,
      actor: contactVerificationEvents.actor,
      adminUserId: contactVerificationEvents.adminUserId,
      waiverReason: contactVerificationEvents.waiverReason,
      occurredAt: contactVerificationEvents.occurredAt,
    })
    .from(contactVerificationEvents)
    .where(
      and(
        eq(contactVerificationEvents.tenantId, context.tenantId),
        eq(contactVerificationEvents.registrationId, registrationId),
      ),
    )
    .orderBy(contactVerificationEvents.occurredAt, contactVerificationEvents.createdAt);
}
