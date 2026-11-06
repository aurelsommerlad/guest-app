import { describe, expect, it } from "vitest";

import { type PropertyRegistrationConfig } from "../registration/registration-model";
import { registrationStatus } from "./registration-status";
import { DEFAULT_CHECK_IN_VALIDATION_POLICY } from "./validation-policy";

const config: PropertyRegistrationConfig = {
  enabled: true,
  country: "AT",
  targets: [],
  primaryGuest: { required: ["firstName", "lastName"], optional: [] },
  companions: { required: ["firstName", "lastName"], optional: [] },
  guestCardRelevant: true,
  providerSettings: {},
  legalTemplate: "at-meldeg",
  validation: DEFAULT_CHECK_IN_VALIDATION_POLICY,
};
const primary = {
  position: 0,
  role: "primary" as const,
  data: {
    firstName: "Lea",
    lastName: "Beispiel",
    email: "lea@example.org",
    phone: "+436641234567",
    birthDate: "1985-02-02",
    nationality: "DE",
    street: "Seestraße 12",
    postalCode: "88131",
    city: "Lindau",
    country: "DE",
    documentType: "passport",
    documentNumber: "C01X00T47",
  },
};

describe("registrationStatus", () => {
  it("derives separate dimensions from stored data – nothing is 'verified'", () => {
    const status = registrationStatus(
      config,
      { status: "draft", guestCount: 1, guests: [primary], billing: { kind: "private" } },
      "2026-12-20",
    );
    expect(status.dimensions).toMatchObject({
      data: "complete",
      address: "formally-valid",
      age: "declared-adult",
      email: "none",
      phone: "disabled",
      identity: "not-required",
      legalRegistration: "manual",
      billing: "private",
    });
    // E-mail confirmation is required by policy but no sender is active yet.
    expect(status.blockers).toEqual(["email-not-verified"]);
    expect(JSON.stringify(status.dimensions)).not.toMatch(/"(address|age|identity)":"verified"/);
  });

  it("company billing shows the VAT id format status", () => {
    const status = registrationStatus(
      config,
      {
        status: "draft",
        guestCount: 1,
        guests: [primary],
        billing: {
          kind: "company",
          companyName: "Muster GmbH",
          street: "Industriestraße 4",
          postalCode: "6900",
          city: "Bregenz",
          country: "AT",
          vatId: "ATU12345678",
        },
      },
      "2026-12-20",
    );
    expect(status.dimensions.billing).toBe("company-pending");
    expect(status.dimensions.vatId).toBe("format-valid");
  });

  it("an under-age main guest is a blocker", () => {
    const minor = { ...primary, data: { ...primary.data, birthDate: "2012-01-01" } };
    const status = registrationStatus(
      config,
      { status: "draft", guestCount: 1, guests: [minor], billing: { kind: "private" } },
      "2026-12-20",
    );
    expect(status.blockers).toContain("responsible-person-under-age");
  });
});
