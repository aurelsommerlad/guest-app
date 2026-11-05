import { describe, expect, it } from "vitest";

import {
  attemptOtp,
  canIssueOtp,
  contactTargetHash,
  generateOtpCode,
  hashOtpCode,
  maskEmail,
  maskPhone,
  newOtpChallenge,
  OTP_POLICIES,
  type OtpSend,
  supersede,
} from "./otp";

const PEPPER = "test-pepper-0123456789abcdef0123456789";
const T0 = new Date("2026-11-05T10:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

function challenge(code = "123456") {
  return newOtpChallenge({
    id: "c1",
    channel: "email",
    targetHash: contactTargetHash(PEPPER, "email", "anna@example.org"),
    code,
    pepper: PEPPER,
    now: T0,
  });
}

describe("codes and hashes", () => {
  it("generates 6-digit codes including leading zeros", () => {
    for (let i = 0; i < 200; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });

  it("stores only a hash bound to the challenge", () => {
    const c = challenge("123456");
    expect(c.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(c.codeHash).not.toContain("123456");
    expect(hashOtpCode(PEPPER, "other", "123456")).not.toBe(c.codeHash);
  });

  it("refuses a short pepper", () => {
    expect(() => hashOtpCode("short", "c1", "123456")).toThrow();
  });

  it("target hashes differ per channel and value", () => {
    const a = contactTargetHash(PEPPER, "email", "anna@example.org");
    expect(contactTargetHash(PEPPER, "sms", "anna@example.org")).not.toBe(a);
    expect(contactTargetHash(PEPPER, "email", "anna@example.com")).not.toBe(a);
  });
});

describe("attemptOtp", () => {
  it("verifies the right code once (single use)", () => {
    const first = attemptOtp(challenge(), "123 456", PEPPER, at(MIN));
    expect(first.outcome).toBe("verified");
    expect(first.challenge.status).toBe("verified");
    expect(first.challenge.verifiedAt).toEqual(at(MIN));
    expect(attemptOtp(first.challenge, "123456", PEPPER, at(2 * MIN)).outcome).toBe("not-pending");
  });

  it("expires after 10 minutes", () => {
    const result = attemptOtp(challenge(), "123456", PEPPER, at(10 * MIN));
    expect(result.outcome).toBe("expired");
    expect(result.challenge.status).toBe("expired");
  });

  it("locks after 5 wrong entries – the right code no longer helps", () => {
    let c = challenge();
    for (let i = 1; i <= 4; i++) {
      const r = attemptOtp(c, "000000", PEPPER, at(i * 1000));
      expect(r.outcome).toBe("wrong-code");
      c = r.challenge;
    }
    const fifth = attemptOtp(c, "000000", PEPPER, at(5000));
    expect(fifth.outcome).toBe("locked");
    expect(attemptOtp(fifth.challenge, "123456", PEPPER, at(6000)).outcome).toBe("locked");
  });

  it("counts malformed entries as attempts", () => {
    const r = attemptOtp(challenge(), "abc", PEPPER, at(1000));
    expect(r.outcome).toBe("wrong-code");
    expect(r.challenge.attempts).toBe(1);
  });

  it("a superseded code cannot be used", () => {
    expect(attemptOtp(supersede(challenge()), "123456", PEPPER, at(1000)).outcome).toBe(
      "not-pending",
    );
  });

  it("uses a different pepper → no match", () => {
    expect(attemptOtp(challenge(), "123456", `${PEPPER}x`, at(1000)).outcome).toBe("wrong-code");
  });
});

describe("canIssueOtp", () => {
  const email = OTP_POLICIES.email;
  const sms = OTP_POLICIES.sms;
  const send = (ms: number, targetHash = "t1"): OtpSend => ({ sentAt: at(ms), targetHash });

  it("allows the first send", () => {
    expect(canIssueOtp(email, [], "t1", T0)).toEqual({ ok: true });
  });

  it("enforces the resend cooldown (e-mail 60 s, SMS 90 s)", () => {
    expect(canIssueOtp(email, [send(0)], "t1", at(59_000))).toEqual({
      ok: false,
      reason: "cooldown",
      retryAt: at(60_000),
    });
    expect(canIssueOtp(email, [send(0)], "t1", at(60_000)).ok).toBe(true);
    expect(canIssueOtp(sms, [send(0)], "t1", at(60_000))).toMatchObject({ reason: "cooldown" });
  });

  it("caps sends per 24 h", () => {
    const history = [0, 2, 4, 6, 8].map((m) => send(m * MIN));
    expect(canIssueOtp(email, history, "t1", at(20 * MIN))).toEqual({
      ok: false,
      reason: "send-limit",
      retryAt: at(24 * 60 * MIN),
    });
    expect(canIssueOtp(email, history, "t1", at(24 * 60 * MIN + 1)).ok).toBe(true);
  });

  it("caps different targets per 24 h but allows resending to a known one", () => {
    const history = [send(0, "a"), send(2 * MIN, "b"), send(4 * MIN, "c")];
    expect(canIssueOtp(email, history, "d", at(10 * MIN))).toMatchObject({
      reason: "target-limit",
    });
    expect(canIssueOtp(email, history, "a", at(10 * MIN)).ok).toBe(true);
    expect(canIssueOtp(sms, [send(0, "a"), send(2 * MIN, "b")], "c", at(10 * MIN))).toMatchObject({
      reason: "target-limit",
    });
  });
});

describe("masking", () => {
  it("shows only what helps the guest recognise the target", () => {
    expect(maskEmail("anna.muster@firma.de")).toBe("a•••@firma.de");
    expect(maskEmail("broken")).toBe("•••");
    expect(maskPhone("+491701234512", "49")).toBe("+49 ••• •••• 12");
  });
});
