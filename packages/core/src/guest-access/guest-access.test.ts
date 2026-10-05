import { describe, expect, it } from "vitest";

import { generateSecret, hashSecret, isSecretHash, isWellFormedSecret } from "./access-token";
import { computeAccessWindow, evaluateAccess } from "./guest-access-model";
import { lastNameMatches, normalizeBookingReference, normalizeLastName } from "./guest-login";

describe("access secrets", () => {
  it("generates 256-bit URL-safe secrets without repetition", () => {
    const secrets = new Set(Array.from({ length: 1000 }, generateSecret));
    expect(secrets.size).toBe(1000);
    for (const secret of secrets) {
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(secret, "base64url")).toHaveLength(32);
      expect(isWellFormedSecret(secret)).toBe(true);
    }
  });

  it("rejects malformed secrets before any lookup", () => {
    for (const value of ["", "abc", "a".repeat(44), `${"a".repeat(42)}/`, `${"a".repeat(42)}=`]) {
      expect(isWellFormedSecret(value)).toBe(false);
    }
  });

  it("hashes deterministically to SHA-256 hex that does not contain the secret", () => {
    const secret = generateSecret();
    const hash = hashSecret(secret);
    expect(isSecretHash(hash)).toBe(true);
    expect(hashSecret(secret)).toBe(hash);
    expect(hash).not.toContain(secret);
    expect(hashSecret(generateSecret())).not.toBe(hash);
    // Known vector: SHA-256("abc").
    expect(hashSecret("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("access window", () => {
  const stay = { arrivalAt: "2026-08-27T16:00:00+02:00", departureAt: "2026-08-31T10:00:00+02:00" };

  it("opens 30 days before arrival and closes 3 days after departure by default", () => {
    expect(computeAccessWindow(stay)).toEqual({
      validFrom: new Date("2026-07-28T16:00:00+02:00"),
      validUntil: new Date("2026-09-03T10:00:00+02:00"),
    });
  });

  it("accepts another policy", () => {
    const window = computeAccessWindow(stay, {
      opensDaysBeforeArrival: 0,
      closesDaysAfterDeparture: 0,
    });
    expect(window.validFrom.toISOString()).toBe("2026-08-27T14:00:00.000Z");
    expect(window.validUntil.toISOString()).toBe("2026-08-31T08:00:00.000Z");
  });

  it("rejects impossible stays", () => {
    expect(() => computeAccessWindow({ arrivalAt: "x", departureAt: stay.departureAt })).toThrow(
      RangeError,
    );
    expect(() =>
      computeAccessWindow({ arrivalAt: stay.departureAt, departureAt: stay.arrivalAt }),
    ).toThrow(RangeError);
  });

  it("evaluates validity", () => {
    const access = {
      validFrom: new Date("2026-08-01T00:00:00Z"),
      validUntil: new Date("2026-09-01T00:00:00Z"),
    };
    expect(evaluateAccess(access, new Date("2026-07-31T23:59:59Z"))).toBe("not-yet-valid");
    expect(evaluateAccess(access, new Date("2026-08-01T00:00:00Z"))).toBe("valid");
    expect(evaluateAccess(access, new Date("2026-09-01T00:00:00Z"))).toBe("expired");
    expect(
      evaluateAccess(
        { ...access, revokedAt: new Date("2026-08-10T00:00:00Z") },
        new Date("2026-08-15T00:00:00Z"),
      ),
    ).toBe("revoked");
  });
});

describe("booking number + last name", () => {
  it("normalises booking references and rejects anything else", () => {
    expect(normalizeBookingReference("  abcdefgh-1 ")).toBe("ABCDEFGH-1");
    expect(normalizeBookingReference("ABCD EFGH-1")).toBe("ABCDEFGH-1");
    for (const invalid of ["", "ab", "../etc", "ABC/1", "ABC?x=1", "A".repeat(41), "-ABC"]) {
      expect(normalizeBookingReference(invalid)).toBeUndefined();
    }
  });

  it("matches last names case-insensitively, trimmed and Unicode-normalised", () => {
    expect(lastNameMatches("  müller ", "Müller")).toBe(true);
    expect(lastNameMatches("MÜLLER", "Müller")).toBe(true);
    // Decomposed "u + combining diaeresis" equals the precomposed "ü".
    expect(lastNameMatches("Müller", "Müller")).toBe(true);
    expect(lastNameMatches("van  der Berg", "Van der Berg")).toBe(true);
    expect(lastNameMatches("Ødegård", "ØDEGÅRD")).toBe(true);
  });

  it("does not match fuzzily", () => {
    expect(lastNameMatches("Mueller", "Müller")).toBe(false);
    expect(lastNameMatches("Muller", "Müller")).toBe(false);
    expect(lastNameMatches("Müll", "Müller")).toBe(false);
    expect(lastNameMatches("Müller-Lüdenscheidt", "Müller")).toBe(false);
  });

  it("never matches empty input or a missing PMS name", () => {
    expect(lastNameMatches("", "Müller")).toBe(false);
    expect(lastNameMatches("   ", "Müller")).toBe(false);
    expect(lastNameMatches("Müller", undefined)).toBe(false);
    expect(lastNameMatches("Müller", "  ")).toBe(false);
    expect(normalizeLastName(" A  B ")).toBe("a b");
  });
});
