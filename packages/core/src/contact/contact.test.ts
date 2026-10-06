import { describe, expect, it } from "vitest";

import { isRelayEmail, normalizeEmail, usableContactEmail } from "./email";
import { callingCodeOptions, formatPhone, normalizePhone, splitPhone } from "./phone";

describe("contact e-mail", () => {
  it("treats Booking.com relay addresses as 'no e-mail'", () => {
    expect(isRelayEmail("4h7k2m9@guest.booking.com")).toBe(true);
    expect(isRelayEmail("x@GUEST.BOOKING.COM")).toBe(true);
    expect(isRelayEmail("x@eu.guest.booking.com")).toBe(true);
    expect(usableContactEmail("example@guest.booking.com")).toBeUndefined();
  });

  it("keeps real addresses, including other OTA or booking.com staff domains", () => {
    expect(usableContactEmail(" Laura.Muster@Example.com ")).toBe("laura.muster@example.com");
    expect(usableContactEmail("guest@booking.com")).toBe("guest@booking.com");
    expect(usableContactEmail("x@notguest.booking.com.example.org")).toBe(
      "x@notguest.booking.com.example.org",
    );
    expect(usableContactEmail("x@fakeguest.booking.com")).toBe("x@fakeguest.booking.com");
  });

  it("rejects garbage", () => {
    for (const value of ["", "laura", "a@b", "a b@example.com", "<x>@example.com"]) {
      expect(normalizeEmail(value), value).toBeUndefined();
    }
    expect(usableContactEmail(undefined)).toBeUndefined();
  });
});

describe("mobile numbers", () => {
  it("normalises international input to E.164", () => {
    expect(normalizePhone("+49 170 1234567")).toEqual({
      ok: true,
      e164: "+491701234567",
      country: "DE",
    });
    expect(normalizePhone("0049 170 1234567")).toMatchObject({ e164: "+491701234567" });
    expect(normalizePhone("0170 1234567", "DE")).toMatchObject({ e164: "+491701234567" });
    expect(normalizePhone("0664 1234567", "AT")).toMatchObject({ e164: "+436641234567" });
    expect(normalizePhone("079 123 45 67", "CH")).toMatchObject({ e164: "+41791234567" });
    expect(normalizePhone("+1 415 555 2671")).toMatchObject({ ok: true });
  });

  it("is not German-only and rejects invalid or landline numbers", () => {
    expect(normalizePhone("0170 1234567")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizePhone("12")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizePhone("+49 abc")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizePhone("+49 30 12345678")).toEqual({ ok: false, reason: "not-mobile" });
  });

  it("splits and formats stored numbers and lists calling codes", () => {
    expect(splitPhone("+436641234567")).toEqual({ country: "AT", national: "0664 1234567" });
    expect(formatPhone("+491701234567")).toBe("+49 170 1234567");
    const options = callingCodeOptions("de");
    expect(options.find((option) => option.value === "AT")).toEqual({
      value: "AT",
      code: "+43",
      name: "Österreich",
    });
    expect(options.length).toBeGreaterThan(200);
  });
});
