import { describe, expect, it, vi } from "vitest";

import { decryptAccessCode, encryptAccessCode, parseAccessCodeKey } from "./access-code-cipher";
import {
  type AccessCredential,
  accessReleaseAt,
  DEFAULT_ACCESS_CONFIG,
  getAccessForStay,
  type PropertyAccessConfig,
} from "./access-model";
import { keyboxCodeSchema, propertyAccessConfigSchema } from "./access-schema";

const window = {
  checkInAt: "2026-08-27T16:00:00+02:00",
  checkOutAt: "2026-08-31T10:00:00+02:00",
  timeZone: "Europe/Berlin",
};
const keybox: PropertyAccessConfig = {
  mode: "keybox",
  release: "arrival-day",
  requiresCompletedRegistration: false,
  instructions: { de: "Die Box hängt links neben der Tür." },
};
const credential: AccessCredential = {
  type: "keybox",
  status: "active",
  validFrom: "2026-08-26T22:00:00.000Z",
  validUntil: window.checkOutAt,
  displayValue: "4711",
  provider: "keybox",
};

function input(overrides: Partial<Parameters<typeof getAccessForStay>[0]> = {}) {
  return {
    config: keybox,
    window,
    registrationCompleted: true,
    now: new Date("2026-08-27T12:00:00+02:00"),
    loadCredential: vi.fn(() => Promise.resolve<AccessCredential | undefined>(credential)),
    ...overrides,
  };
}

describe("getAccessForStay", () => {
  it("releases on the local arrival day, never earlier", async () => {
    expect(accessReleaseAt(keybox, window).toISOString()).toBe("2026-08-26T22:00:00.000Z");
    expect(accessReleaseAt({ release: "check-in-time" }, window).toISOString()).toBe(
      "2026-08-27T14:00:00.000Z",
    );
    const early = input({ now: new Date("2026-08-26T23:59:00+02:00") });
    expect(await getAccessForStay(early)).toEqual({
      status: "pending",
      reason: "not-yet-released",
      releasesAt: "2026-08-26T22:00:00.000Z",
    });
    // The credential is not even loaded before release.
    expect(early.loadCredential).not.toHaveBeenCalled();
  });

  it("hides the code unless explicitly revealed", async () => {
    const shown = await getAccessForStay(input());
    expect(shown).toMatchObject({ status: "available", credential: { type: "keybox" } });
    expect(JSON.stringify(shown)).not.toContain("4711");
    // Provider internals never reach the guest result.
    expect(JSON.stringify(shown)).not.toContain('"provider"');
    const revealed = await getAccessForStay(input({ includeDisplayValue: true }));
    expect(revealed).toMatchObject({ credential: { displayValue: "4711" } });
  });

  it("requires a completed registration only where the property says so", async () => {
    const strict = { ...keybox, requiresCompletedRegistration: true };
    const blocked = input({ config: strict, registrationCompleted: false });
    expect(await getAccessForStay(blocked)).toEqual({
      status: "pending",
      reason: "registration-required",
    });
    expect(blocked.loadCredential).not.toHaveBeenCalled();
    expect((await getAccessForStay(input({ registrationCompleted: false }))).status).toBe(
      "available",
    );
  });

  it("falls back to manual instructions and ends with the stay", async () => {
    expect(await getAccessForStay(input({ config: DEFAULT_ACCESS_CONFIG }))).toEqual({
      status: "manual",
    });
    expect(
      await getAccessForStay(input({ loadCredential: () => Promise.resolve(undefined) })),
    ).toEqual({ status: "manual", instructions: keybox.instructions });
    expect(
      await getAccessForStay(input({ now: new Date("2026-08-31T10:00:00+02:00") })),
    ).toMatchObject({ status: "pending" });
    const revoked = { ...credential, status: "revoked" as const };
    expect(
      await getAccessForStay(input({ loadCredential: () => Promise.resolve(revoked) })),
    ).toEqual({ status: "pending", reason: "not-issued" });
  });
});

describe("access configuration and key box codes", () => {
  it("validates settings and codes", () => {
    expect(propertyAccessConfigSchema.parse(keybox)).toEqual(keybox);
    expect(propertyAccessConfigSchema.safeParse({ ...keybox, mode: "nuki" }).success).toBe(false);
    expect(keyboxCodeSchema.parse(" 47 11 ")).toBe("4711");
    expect(keyboxCodeSchema.safeParse("47").success).toBe(false);
    expect(keyboxCodeSchema.safeParse("12345678901234").success).toBe(false);
  });

  it("encrypts codes bound to their unit", () => {
    const key = parseAccessCodeKey(Buffer.alloc(32, 7).toString("base64"));
    const binding = { tenantId: "unique-places", propertyId: "hov", unitId: "ros" };
    const stored = encryptAccessCode(key, binding, "4711");
    expect(stored).toMatch(/^v1\./);
    expect(stored).not.toContain("4711");
    expect(encryptAccessCode(key, binding, "4711")).not.toBe(stored);
    expect(decryptAccessCode(key, binding, stored)).toBe("4711");
    expect(decryptAccessCode(key, { ...binding, unitId: "khu" }, stored)).toBeUndefined();
    expect(decryptAccessCode(key, { ...binding, tenantId: "other" }, stored)).toBeUndefined();
    const otherKey = parseAccessCodeKey(Buffer.alloc(32, 8).toString("base64"));
    expect(decryptAccessCode(otherKey, binding, stored)).toBeUndefined();
    expect(decryptAccessCode(key, binding, "v1.x.y")).toBeUndefined();
    expect(() => parseAccessCodeKey("c2hvcnQ=")).toThrow();
  });
});
