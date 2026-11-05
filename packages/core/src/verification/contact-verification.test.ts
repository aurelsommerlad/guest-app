import { describe, expect, it } from "vitest";

import { usableContactEmail } from "../contact/email";
import {
  contactVerificationStatus,
  contactWaiverSchema,
  DEFAULT_SMS_VERIFICATION,
  satisfiesRequiredVerification,
  smsAvailability,
  smsVerificationConfigSchema,
} from "./contact-verification";

const T = new Date("2026-11-05T10:00:00Z");
const sms = { ...DEFAULT_SMS_VERIFICATION, mode: "optional" as const };

describe("contactVerificationStatus", () => {
  it("none without value or record", () => {
    expect(contactVerificationStatus(undefined, undefined)).toBe("none");
    expect(contactVerificationStatus(undefined, "h1")).toBe("none");
  });

  it("verified only for the exact confirmed value", () => {
    const record = { channel: "email" as const, verifiedTargetHash: "h1", verifiedAt: T };
    expect(contactVerificationStatus(record, "h1")).toBe("verified");
    expect(contactVerificationStatus(record, "h2")).toBe("none");
  });

  it("pending / locked for an open challenge of the current value", () => {
    const pending = {
      channel: "email" as const,
      openChallenge: { targetHash: "h1", status: "pending" as const, expiresAt: T },
    };
    expect(contactVerificationStatus(pending, "h1")).toBe("pending");
    expect(contactVerificationStatus(pending, "h2")).toBe("none");
    expect(
      contactVerificationStatus(
        { ...pending, openChallenge: { ...pending.openChallenge, status: "locked" } },
        "h1",
      ),
    ).toBe("locked");
  });

  it("a staff waiver is 'waived', not 'verified'", () => {
    const waiver = contactWaiverSchema.parse({
      adminUserId: "adm-1",
      reason: "delivery-failed",
      at: T,
    });
    expect(contactVerificationStatus({ channel: "email", waiver }, "h1")).toBe("waived");
  });

  it("only verified and waived satisfy a required verification", () => {
    expect(satisfiesRequiredVerification("verified")).toBe(true);
    expect(satisfiesRequiredVerification("waived")).toBe(true);
    for (const status of [
      "none",
      "pending",
      "locked",
      "unsupported-country",
      "disabled",
    ] as const) {
      expect(satisfiesRequiredVerification(status)).toBe(false);
    }
  });

  it("relay addresses never reach verification (they are not a usable e-mail)", () => {
    expect(usableContactEmail("abc123@guest.booking.com")).toBeUndefined();
    expect(usableContactEmail("x@sub.guest.booking.com")).toBeUndefined();
  });
});

describe("waiver", () => {
  it("needs an accountable admin and a reason", () => {
    expect(contactWaiverSchema.safeParse({ reason: "delivery-failed", at: T }).success).toBe(false);
    expect(contactWaiverSchema.safeParse({ adminUserId: "a", reason: "nope", at: T }).success).toBe(
      false,
    );
  });

  it("requires a note for 'other' and rejects markup", () => {
    expect(
      contactWaiverSchema.safeParse({ adminUserId: "a", reason: "other", at: T }).success,
    ).toBe(false);
    expect(
      contactWaiverSchema.safeParse({
        adminUserId: "a",
        reason: "other",
        note: "Gast vor Ort",
        at: T,
      }).success,
    ).toBe(true);
    expect(
      contactWaiverSchema.safeParse({
        adminUserId: "a",
        reason: "other",
        note: "<b>x</b> yy",
        at: T,
      }).success,
    ).toBe(false);
  });
});

describe("SMS (prepared, optional)", () => {
  it("is off by default and supports DE, AT, CH", () => {
    expect(DEFAULT_SMS_VERIFICATION).toEqual({
      mode: "off",
      supportedCountries: ["DE", "AT", "CH"],
    });
    expect(smsAvailability("+491701234567", DEFAULT_SMS_VERIFICATION)).toBe("disabled");
  });

  it("available for DE/AT/CH mobiles", () => {
    expect(smsAvailability("+491701234567", sms)).toBe("available");
    expect(smsAvailability("+436641234567", sms)).toBe("available");
    expect(smsAvailability("+41791234567", sms)).toBe("available");
  });

  it("international numbers are unsupported – never blocking", () => {
    expect(smsAvailability("+447400123456", sms)).toBe("unsupported-country");
    expect(
      contactVerificationStatus(undefined, "h1", { availability: "unsupported-country" }),
    ).toBe("unsupported-country");
  });

  it("further countries can be configured", () => {
    const wider = smsVerificationConfigSchema.parse({
      mode: "optional",
      supportedCountries: ["DE", "GB"],
    });
    expect(smsAvailability("+447400123456", wider)).toBe("available");
    expect(
      smsVerificationConfigSchema.safeParse({ mode: "optional", supportedCountries: ["XX"] })
        .success,
    ).toBe(false);
    expect(
      smsVerificationConfigSchema.safeParse({ mode: "required", supportedCountries: ["DE"] })
        .success,
    ).toBe(false);
  });
});
