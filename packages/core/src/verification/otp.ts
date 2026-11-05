/**
 * One-time codes for contact verification (ADR 0021) – e-mail now, SMS prepared.
 *
 * - 6 digits from the OS CSPRNG. Only HMAC-SHA256(pepper, challengeId ‖ code) is stored; the
 *   pepper is a server secret (env), so a database dump alone does not allow offline guessing
 *   of the 10^6 code space.
 * - Short validity, single use, limited wrong attempts, resend cooldown, caps per reservation
 *   and per target within a rolling window. Answers to the guest are uniform (no hint whether a
 *   target exists).
 * - A confirmed code proves control of the mailbox / phone at that moment – nothing about
 *   identity, age or address.
 *
 * Pure functions: persistence, rate-limit buckets and sending live in the app (C2+).
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_CHANNELS = ["email", "sms"] as const;
export type OtpChannel = (typeof OTP_CHANNELS)[number];

export const OTP_CODE_LENGTH = 6;

export type OtpPolicy = {
  /** Validity of one code. */
  ttlMs: number;
  /** Wrong entries per code before it is locked. */
  maxAttempts: number;
  /** Minimum distance between two sends for the same reservation and channel. */
  resendCooldownMs: number;
  /** Sends per reservation and channel within `windowMs`. */
  maxSendsPerWindow: number;
  /** Different targets (addresses / numbers) per reservation within `windowMs`. */
  maxTargetsPerWindow: number;
  windowMs: number;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const OTP_POLICIES: Readonly<Record<OtpChannel, OtpPolicy>> = {
  email: {
    ttlMs: 10 * MINUTE,
    maxAttempts: 5,
    resendCooldownMs: 60_000,
    maxSendsPerWindow: 5,
    maxTargetsPerWindow: 3,
    windowMs: 24 * HOUR,
  },
  // SMS costs money and is a fraud target (SMS pumping): stricter caps.
  sms: {
    ttlMs: 10 * MINUTE,
    maxAttempts: 5,
    resendCooldownMs: 90_000,
    maxSendsPerWindow: 3,
    maxTargetsPerWindow: 2,
    windowMs: 24 * HOUR,
  },
};

/** Uniformly distributed 6-digit code (leading zeros allowed). */
export function generateOtpCode(): string {
  return randomInt(0, 10 ** OTP_CODE_LENGTH)
    .toString()
    .padStart(OTP_CODE_LENGTH, "0");
}

const MIN_PEPPER_LENGTH = 32;

function hmac(pepper: string, ...parts: string[]): string {
  if (pepper.length < MIN_PEPPER_LENGTH) throw new Error("OTP pepper too short");
  const mac = createHmac("sha256", pepper);
  for (const part of parts) mac.update(`${part.length}:${part}`, "utf8");
  return mac.digest("hex");
}

/** Stored form of a code, bound to its challenge (a code is useless for other challenges). */
export function hashOtpCode(pepper: string, challengeId: string, code: string): string {
  return hmac(pepper, "otp", challengeId, code);
}

/**
 * Stored form of a verified target (normalised e-mail / E.164 number). Lets us tell whether
 * the current value is still the confirmed one without keeping a second plain copy.
 */
export function contactTargetHash(pepper: string, channel: OtpChannel, value: string): string {
  return hmac(pepper, "target", channel, value);
}

function equalHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/* ------------------------------------------------------------------------------------------
 * Issuing
 * ---------------------------------------------------------------------------------------- */

/** One earlier send for this reservation and channel. */
export type OtpSend = { sentAt: Date; targetHash: string };

export type OtpIssueDecision =
  { ok: true } | { ok: false; reason: "cooldown" | "send-limit" | "target-limit"; retryAt: Date };

export function canIssueOtp(
  policy: OtpPolicy,
  history: readonly OtpSend[],
  targetHash: string,
  now: Date,
): OtpIssueDecision {
  const windowStart = now.getTime() - policy.windowMs;
  const recent = history
    .filter((send) => send.sentAt.getTime() > windowStart)
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const last = recent.at(-1);
  if (last && now.getTime() - last.sentAt.getTime() < policy.resendCooldownMs) {
    return {
      ok: false,
      reason: "cooldown",
      retryAt: new Date(last.sentAt.getTime() + policy.resendCooldownMs),
    };
  }
  const oldest = recent[0];
  const windowFreesAt = oldest ? new Date(oldest.sentAt.getTime() + policy.windowMs) : now;
  if (recent.length >= policy.maxSendsPerWindow) {
    return { ok: false, reason: "send-limit", retryAt: windowFreesAt };
  }
  const targets = new Set(recent.map((send) => send.targetHash));
  if (!targets.has(targetHash) && targets.size >= policy.maxTargetsPerWindow) {
    return { ok: false, reason: "target-limit", retryAt: windowFreesAt };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------------------------------
 * Checking
 * ---------------------------------------------------------------------------------------- */

export const OTP_CHALLENGE_STATUSES = [
  "pending",
  "verified",
  "expired",
  "locked",
  "superseded",
] as const;
export type OtpChallengeStatus = (typeof OTP_CHALLENGE_STATUSES)[number];

export type OtpChallenge = {
  id: string;
  channel: OtpChannel;
  targetHash: string;
  codeHash: string;
  createdAt: Date;
  expiresAt: Date;
  attempts: number;
  status: OtpChallengeStatus;
  verifiedAt?: Date;
};

export function newOtpChallenge(input: {
  id: string;
  channel: OtpChannel;
  targetHash: string;
  code: string;
  pepper: string;
  now: Date;
  policy?: OtpPolicy;
}): OtpChallenge {
  const policy = input.policy ?? OTP_POLICIES[input.channel];
  return {
    id: input.id,
    channel: input.channel,
    targetHash: input.targetHash,
    codeHash: hashOtpCode(input.pepper, input.id, input.code),
    createdAt: input.now,
    expiresAt: new Date(input.now.getTime() + policy.ttlMs),
    attempts: 0,
    status: "pending",
  };
}

export type OtpAttemptOutcome = "verified" | "wrong-code" | "expired" | "locked" | "not-pending";

/** Digits only; spaces/dashes the guest typed are ignored. */
export function normalizeOtpInput(value: string): string {
  return value.replace(/[\s-]/g, "");
}

/**
 * One entry by the guest. Returns the outcome and the challenge to persist. Every entry on a
 * pending code counts as an attempt, malformed ones included (no free probing).
 */
export function attemptOtp(
  challenge: OtpChallenge,
  input: string,
  pepper: string,
  now: Date,
  policy: OtpPolicy = OTP_POLICIES[challenge.channel],
): { outcome: OtpAttemptOutcome; challenge: OtpChallenge } {
  if (challenge.status === "locked") return { outcome: "locked", challenge };
  if (challenge.status !== "pending") return { outcome: "not-pending", challenge };
  if (now.getTime() >= challenge.expiresAt.getTime()) {
    return { outcome: "expired", challenge: { ...challenge, status: "expired" } };
  }
  const attempts = challenge.attempts + 1;
  const code = normalizeOtpInput(input);
  const wellFormed = new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`).test(code);
  const matches =
    wellFormed && equalHex(hashOtpCode(pepper, challenge.id, code), challenge.codeHash);
  if (matches) {
    return {
      outcome: "verified",
      challenge: { ...challenge, attempts, status: "verified", verifiedAt: now },
    };
  }
  if (attempts >= policy.maxAttempts) {
    return { outcome: "locked", challenge: { ...challenge, attempts, status: "locked" } };
  }
  return { outcome: "wrong-code", challenge: { ...challenge, attempts } };
}

/** A new code for the same target replaces any pending one. */
export function supersede(challenge: OtpChallenge): OtpChallenge {
  return challenge.status === "pending" ? { ...challenge, status: "superseded" } : challenge;
}

/* ------------------------------------------------------------------------------------------
 * Masking for display
 * ---------------------------------------------------------------------------------------- */

/** "anna.muster@firma.de" → "a•••@firma.de". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

/** "+491701234512" → "+49 ••• •••• 12" (country calling code and last two digits only). */
export function maskPhone(e164: string, callingCode: string): string {
  const digits = e164.replace(/\D/g, "");
  return `+${callingCode} ••• •••• ${digits.slice(-2)}`;
}
