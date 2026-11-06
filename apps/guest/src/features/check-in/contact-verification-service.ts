/**
 * Contact verification in the online check-in (ADR 0021, C4 e-mail / C5 SMS prepared).
 *
 * - Only the main guest's e-mail (and, once approved, mobile number) is verified – by a
 *   6-digit one-time code. Stored: HMACs of the code and of the confirmed value, never the code.
 * - Limits: code validity, wrong attempts, resend cooldown, sends and targets per check-in
 *   (core OTP_POLICIES), sends per target across check-ins, plus the check-in write limit.
 * - The confirmation belongs to the exact value: a changed address must be confirmed again.
 * - Failed or locked codes never touch the check-in data; a documented staff waiver is the
 *   manual alternative (repository: waiveContactVerification).
 * - Sending: no provider is active without approval. "simulated" (local only) sends nothing;
 *   without pepper or sender the verification is "not offered" and never blocks the guest.
 * - Nothing personal is logged: ids, channels and outcome codes only.
 */
import {
  attemptOtp,
  canIssueOtp,
  contactTargetHash,
  type ContactVerificationStatus,
  contactVerificationStatus,
  generateOtpCode,
  maskEmail,
  newOtpChallenge,
  OTP_POLICIES,
  type OtpChallenge,
  type OtpChannel,
  satisfiesRequiredVerification,
  smsAvailability,
  type VerificationDelivery,
  type VerificationEmailSender,
  type VerificationSmsSender,
} from "@up/core";
import {
  countTargetSends,
  hitRateLimit,
  listVerificationSends,
  loadContactVerification,
  recordVerificationAttempt,
  recordVerificationChallenge,
  type StoredChallenge,
} from "@up/db";
import { randomUUID } from "node:crypto";

import { type GuestContext } from "../guest-context/guest-context";
import { type StayJourney } from "../journey/stay-journey";
import { type CheckInDeps, prepareCheckInWrite } from "./check-in-service";

import { type EMAIL_DELIVERY_MODES, type SMS_DELIVERY_MODES } from "../../env/schema";

export type EmailDeliveryMode = (typeof EMAIL_DELIVERY_MODES)[number];
export type SmsDeliveryMode = (typeof SMS_DELIVERY_MODES)[number];

/** Sends to one address / number across all check-ins per 24 h (anti mail/SMS bombing). */
export const MAX_SENDS_PER_TARGET = 10;

export type VerificationDeps = CheckInDeps & {
  /** Server secret (OTP_PEPPER, ≥ 32 chars). Without it nothing is offered. */
  pepper?: string;
  email: { mode: EmailDeliveryMode; sender?: VerificationEmailSender };
  sms: { mode: SmsDeliveryMode; sender?: VerificationSmsSender };
};

const MAIN_GUEST = 0;

export type ContactVerificationView = {
  channel: OtpChannel;
  /** The property requires it for a complete check-in. */
  required: boolean;
  /** A code can be sent right now (policy on, pepper and sender configured). */
  offered: boolean;
  status: ContactVerificationStatus;
  masked?: string;
  /** A pending code for the current value. */
  pending?: { expiresAt: Date; attemptsLeft: number; resendAt: Date; simulated: boolean };
  /** Submitting waits for the confirmation (only when it can actually be given). */
  blocksSubmit: boolean;
};

function primaryValue(journey: StayJourney, channel: OtpChannel): string | undefined {
  const data = journey.registration?.guests.find((guest) => guest.position === MAIN_GUEST)?.data;
  return channel === "email" ? data?.email : data?.phone;
}

function deliveryReady(deps: VerificationDeps, channel: OtpChannel): boolean {
  if (!deps.pepper || deps.pepper.length < 32) return false;
  const delivery = channel === "email" ? deps.email : deps.sms;
  return delivery.mode !== "off" && delivery.sender !== undefined;
}

function policyFor(journey: StayJourney, channel: OtpChannel) {
  const validation = journey.settings.registration.validation;
  if (channel === "email") {
    const mode = validation?.emailVerification ?? "off";
    return { on: mode !== "off", required: mode === "required" };
  }
  // SMS can never be required (schema allows "off" | "optional").
  return { on: validation?.smsVerification.mode === "optional", required: false };
}

function view(
  deps: VerificationDeps,
  journey: StayJourney,
  channel: OtpChannel,
  state: Awaited<ReturnType<typeof loadContactVerification>> | undefined,
): ContactVerificationView {
  const policy = policyFor(journey, channel);
  const value = primaryValue(journey, channel);
  const smsConfig = journey.settings.registration.validation?.smsVerification;
  // SMS only to supported countries (cost, fraud); other numbers are never blocked by it.
  const availability =
    channel === "sms" && value && smsConfig
      ? policy.on
        ? smsAvailability(value, smsConfig)
        : ("disabled" as const)
      : undefined;
  const offered =
    policy.on &&
    deliveryReady(deps, channel) &&
    value !== undefined &&
    (availability === undefined || availability === "available");
  const targetHash =
    value && deps.pepper && deps.pepper.length >= 32
      ? contactTargetHash(deps.pepper, channel, value)
      : undefined;
  const latest = state?.latest;
  const status = contactVerificationStatus(
    {
      channel,
      ...(state?.verifiedHash ? { verifiedTargetHash: state.verifiedHash } : {}),
      ...(state?.verifiedAt ? { verifiedAt: state.verifiedAt } : {}),
      ...(state?.waiver ? { waiver: state.waiver } : {}),
      ...(latest && (latest.status === "pending" || latest.status === "locked")
        ? {
            openChallenge: {
              targetHash: latest.targetHash,
              status: latest.status,
              expiresAt: latest.expiresAt,
            },
          }
        : {}),
    },
    targetHash,
    availability ? { availability } : {},
  );
  const policyOtp = OTP_POLICIES[channel];
  const pendingChallenge =
    latest?.status === "pending" &&
    latest.targetHash === targetHash &&
    latest.expiresAt.getTime() > deps.now().getTime()
      ? latest
      : undefined;
  return {
    channel,
    required: policy.required,
    offered,
    status,
    ...(value ? { masked: channel === "email" ? maskEmail(value) : `••• ${value.slice(-2)}` } : {}),
    ...(pendingChallenge
      ? {
          pending: {
            expiresAt: pendingChallenge.expiresAt,
            attemptsLeft: Math.max(0, policyOtp.maxAttempts - pendingChallenge.attempts),
            resendAt: new Date(pendingChallenge.createdAt.getTime() + policyOtp.resendCooldownMs),
            simulated: pendingChallenge.delivery === "simulated",
          },
        }
      : {}),
    blocksSubmit: policy.required && offered && !satisfiesRequiredVerification(status),
  };
}

/** Current verification state of the main guest's e-mail or phone (read-only). */
export async function contactVerificationView(
  deps: VerificationDeps,
  context: GuestContext,
  journey: StayJourney,
  channel: OtpChannel,
): Promise<ContactVerificationView> {
  const registration = journey.registration;
  if (!deps.db || !registration) return view(deps, journey, channel, undefined);
  const state = await loadContactVerification(
    deps.db,
    context,
    registration.id,
    MAIN_GUEST,
    channel,
  );
  return view(deps, journey, channel, state);
}

export type SendCodeResult =
  | { ok: true; simulated: boolean }
  | {
      ok: false;
      reason:
        | "unavailable"
        | "rate-limited"
        | "not-offered"
        | "no-value"
        | "already-verified"
        | "cooldown"
        | "send-limit"
        | "delivery-failed";
      retryAt?: Date;
    };

/** Sends a new code to the main guest's current value (replaces a pending one). */
export async function sendVerificationCode(
  deps: VerificationDeps,
  context: GuestContext,
  input: { channel: OtpChannel; locale: "de" | "en" },
): Promise<SendCodeResult> {
  const prepared = await prepareCheckInWrite(deps, context);
  if (!("db" in prepared)) {
    return {
      ok: false,
      reason: prepared.reason === "rate-limited" ? "rate-limited" : "unavailable",
    };
  }
  const { db, journey } = prepared;
  const registration = journey.registration;
  if (!registration) return { ok: false, reason: "unavailable" };
  const current = await contactVerificationView(deps, context, journey, input.channel);
  if (!current.offered || !deps.pepper) return { ok: false, reason: "not-offered" };
  const value = primaryValue(journey, input.channel);
  if (!value) return { ok: false, reason: "no-value" };
  if (current.status === "verified") return { ok: false, reason: "already-verified" };

  const now = deps.now();
  const policy = OTP_POLICIES[input.channel];
  const targetHash = contactTargetHash(deps.pepper, input.channel, value);
  const since = new Date(now.getTime() - policy.windowMs);
  const history = await listVerificationSends(db, context, registration.id, input.channel, since);
  const decision = canIssueOtp(policy, history, targetHash, now);
  if (!decision.ok) {
    deps.logger.info("contact code refused", {
      registrationId: registration.id,
      channel: input.channel,
      reason: decision.reason,
    });
    return {
      ok: false,
      reason: decision.reason === "cooldown" ? "cooldown" : "send-limit",
      retryAt: decision.retryAt,
    };
  }
  if ((await countTargetSends(db, context, targetHash, since)) >= MAX_SENDS_PER_TARGET) {
    return { ok: false, reason: "send-limit" };
  }

  const code = generateOtpCode();
  const challenge: OtpChallenge = newOtpChallenge({
    id: randomUUID(),
    channel: input.channel,
    targetHash,
    code,
    pepper: deps.pepper,
    now,
  });
  const delivery = input.channel === "email" ? deps.email : deps.sms;
  let outcome: VerificationDelivery = "failed";
  try {
    const sent = await delivery.sender?.sendVerificationCode({
      to: value,
      code,
      locale: input.locale,
      propertyName: context.property.name,
      validMinutes: Math.round(policy.ttlMs / 60_000),
      idempotencyKey: challenge.id,
    });
    if (sent?.ok) outcome = delivery.mode === "simulated" ? "simulated" : "sent";
    else if (sent) {
      deps.logger.warn("contact code not delivered", {
        registrationId: registration.id,
        channel: input.channel,
        reason: sent.reason,
      });
    }
  } catch (error) {
    deps.logger.warn("contact code sender failed", {
      registrationId: registration.id,
      channel: input.channel,
      error: error instanceof Error ? { name: error.name } : "unknown",
    });
  }
  await recordVerificationChallenge(db, context, {
    registrationId: registration.id,
    position: MAIN_GUEST,
    challenge,
    delivery: outcome,
  });
  deps.logger.info("contact code issued", {
    registrationId: registration.id,
    channel: input.channel,
    delivery: outcome,
  });
  if (outcome === "failed") return { ok: false, reason: "delivery-failed" };
  return { ok: true, simulated: outcome === "simulated" };
}

export type ConfirmCodeResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "unavailable"
        | "rate-limited"
        | "not-offered"
        | "no-code"
        | "wrong-code"
        | "expired"
        | "locked"
        | "changed";
      attemptsLeft?: number;
    };

/** Checks a code the guest typed against the pending challenge of the current value. */
export async function confirmVerificationCode(
  deps: VerificationDeps,
  context: GuestContext,
  input: { channel: OtpChannel; code: string },
): Promise<ConfirmCodeResult> {
  const prepared = await prepareCheckInWrite(deps, context);
  if (!("db" in prepared)) {
    return {
      ok: false,
      reason: prepared.reason === "rate-limited" ? "rate-limited" : "unavailable",
    };
  }
  const { db, journey } = prepared;
  const registration = journey.registration;
  if (!registration || !deps.pepper || deps.pepper.length < 32) {
    return { ok: false, reason: "not-offered" };
  }
  const value = primaryValue(journey, input.channel);
  const state = await loadContactVerification(
    db,
    context,
    registration.id,
    MAIN_GUEST,
    input.channel,
  );
  const latest: StoredChallenge | undefined = state.latest;
  if (!latest || (latest.status !== "pending" && latest.status !== "locked")) {
    return { ok: false, reason: "no-code" };
  }
  const currentTargetHash = value
    ? contactTargetHash(deps.pepper, input.channel, value)
    : undefined;
  if (latest.targetHash !== currentTargetHash) return { ok: false, reason: "changed" };
  // A locked code stays locked – no further attempt is counted or checked.
  if (latest.status === "locked") return { ok: false, reason: "locked" };
  // Extra guard against parallel guessing on one check-in (the per-code limit is the main one).
  const bucket = await hitRateLimit(
    db,
    `otp-confirm:${registration.id}:${input.channel}`,
    15 * 60_000,
    deps.now(),
  );
  if (bucket.hits > 20) return { ok: false, reason: "rate-limited" };

  const now = deps.now();
  const { outcome, challenge } = attemptOtp(latest, input.code.slice(0, 20), deps.pepper, now);
  const saved = await recordVerificationAttempt(db, context, {
    registrationId: registration.id,
    position: MAIN_GUEST,
    before: latest,
    after: challenge,
    outcome,
    currentTargetHash,
    now,
  });
  deps.logger.info("contact code checked", {
    registrationId: registration.id,
    channel: input.channel,
    outcome: saved === "conflict" ? "conflict" : outcome,
  });
  if (saved === "conflict") return { ok: false, reason: "wrong-code" };
  if (outcome === "verified") return { ok: true };
  if (outcome === "wrong-code") {
    return {
      ok: false,
      reason: "wrong-code",
      attemptsLeft: Math.max(0, OTP_POLICIES[input.channel].maxAttempts - challenge.attempts),
    };
  }
  if (outcome === "expired") return { ok: false, reason: "expired" };
  if (outcome === "locked") return { ok: false, reason: "locked" };
  return { ok: false, reason: "no-code" };
}

/**
 * After the guest saved their e-mail: send a code right away (best effort) so it is waiting
 * when they reach the review – no extra click. Only if nothing is pending or confirmed for
 * the current value; limits apply as for a manual send.
 */
export async function sendCodeIfDue(
  deps: VerificationDeps,
  context: GuestContext,
  journey: StayJourney,
  locale: "de" | "en",
): Promise<void> {
  try {
    const current = await contactVerificationView(deps, context, journey, "email");
    if (!current.offered || current.status !== "none" || current.pending) return;
    await sendVerificationCode(deps, context, { channel: "email", locale });
  } catch (error) {
    deps.logger.warn("contact code auto-send failed", {
      error: error instanceof Error ? { name: error.name } : "unknown",
    });
  }
}
