import { encryptAccessCode, parseAccessCodeKey } from "@up/core";
import { describe, expect, it } from "vitest";

import { capturingLogger } from "../apaleo/test-helpers";
import { FeratelRegistrationProvider } from "../feratel/feratel-registration-provider";
import { KeyboxAccessProvider } from "./keybox-access-provider";

const key = parseAccessCodeKey(Buffer.alloc(32, 1).toString("base64"));
const request = {
  tenantId: "unique-places",
  propertyId: "hov",
  unitId: "ros",
  reservation: { provider: "apaleo", externalReservationId: "ABCDEFGH-1" },
  checkInAt: "2026-08-27T16:00:00+02:00",
  checkOutAt: "2026-08-31T10:00:00+02:00",
};

describe("KeyboxAccessProvider", () => {
  it("decrypts the unit's code into a normalised credential", async () => {
    const stored = encryptAccessCode(
      key,
      { tenantId: "unique-places", propertyId: "hov", unitId: "ros" },
      "4711",
    );
    const { logger } = capturingLogger();
    const provider = new KeyboxAccessProvider({
      key,
      logger,
      loadCiphertext: () => Promise.resolve(stored),
    });
    expect(await provider.getCredential(request)).toEqual({
      type: "keybox",
      status: "active",
      validFrom: request.checkInAt,
      validUntil: request.checkOutAt,
      displayValue: "4711",
      provider: "keybox",
    });
    expect(await provider.getCredential({ ...request, unitId: undefined })).toBeUndefined();
  });

  it("returns nothing for a code of another unit and never logs it", async () => {
    const foreign = encryptAccessCode(
      key,
      { tenantId: "unique-places", propertyId: "hov", unitId: "khu" },
      "9999",
    );
    const { logger, lines } = capturingLogger();
    const provider = new KeyboxAccessProvider({
      key,
      logger,
      loadCiphertext: () => Promise.resolve(foreign),
    });
    expect(await provider.getCredential(request)).toBeUndefined();
    expect(lines.join("\n")).not.toContain("9999");
    expect(lines.join("\n")).not.toContain(foreign);
  });
});

describe("FeratelRegistrationProvider (skeleton)", () => {
  it("never sends anything and reports not_configured", async () => {
    expect(FeratelRegistrationProvider.implemented).toBe(false);
    const provider = new FeratelRegistrationProvider();
    expect(
      await provider.submit(
        {
          registrationId: "x",
          tenantId: "unique-places",
          propertyId: "huesle",
          reservation: { provider: "apaleo", externalReservationId: "A-1" },
          arrivalAt: request.checkInAt,
          departureAt: request.checkOutAt,
          guests: [],
          settings: {},
        },
        {},
      ),
    ).toEqual({ status: "failed", code: "not_configured" });
  });
});
