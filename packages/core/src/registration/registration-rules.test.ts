import { describe, expect, it } from "vitest";

import { type PropertyRegistrationConfig, type RegistrationGuest } from "./registration-model";
import {
  ageOn,
  assessRegistration,
  fieldsForRole,
  guestMissingFields,
  guestStepFields,
  missingFields,
  normalizeGuestInput,
  propertyRegistrationConfigSchema,
  REGISTRATION_DISABLED,
  rulesFor,
} from "./registration-rules";
import { nextSyncState, retryDelayMs } from "./registration-sync";

/** Test configuration only – real required fields are confirmed per property (ADR 0016). */
const config: PropertyRegistrationConfig = {
  enabled: true,
  country: "DE",
  targets: ["apaleo"],
  primaryGuest: {
    required: [
      "firstName",
      "lastName",
      "birthDate",
      "nationality",
      "street",
      "postalCode",
      "city",
      "country",
    ],
    optional: [],
  },
  companions: { required: ["firstName", "lastName", "birthDate", "nationality"], optional: [] },
  children: { underAge: 18, required: ["firstName", "lastName", "birthDate"], optional: [] },
  guestCardRelevant: false,
  providerSettings: {},
};

const today = "2026-08-01";
const arrival = "2026-08-27";

describe("property registration config", () => {
  it("accepts a valid configuration and the disabled default", () => {
    expect(propertyRegistrationConfigSchema.parse(config)).toEqual(config);
    expect(propertyRegistrationConfigSchema.parse(REGISTRATION_DISABLED).enabled).toBe(false);
  });

  it("rejects configurations without names, with duplicates, unknown fields or secrets-like keys", () => {
    const bad = [
      { ...config, primaryGuest: { required: ["birthDate"], optional: [] } },
      { ...config, primaryGuest: { required: ["firstName", "lastName"], optional: ["firstName"] } },
      {
        ...config,
        companions: { required: ["firstName", "lastName", "passportPhoto"], optional: [] },
      },
      { ...config, targets: ["apaleo", "apaleo"] },
      { ...config, targets: ["nuki"] },
      { ...config, country: "XX" },
      { ...config, providerSettings: { feratel: { "bad key": "x" } } },
      { ...config, unknown: true },
    ];
    for (const value of bad) {
      expect(propertyRegistrationConfigSchema.safeParse(value).success, JSON.stringify(value)).toBe(
        false,
      );
    }
  });
});

describe("guest input", () => {
  it("keeps only fields the property asks for and normalises values", () => {
    const { data, errors } = normalizeGuestInput(
      {
        firstName: "  Laura  ",
        lastName: "Muster",
        birthDate: "1990-05-17",
        nationality: "de",
        email: "laura@example.com",
        documentNumber: "X123",
        street: "",
      },
      fieldsForRole(config, "primary"),
      today,
    );
    expect(errors).toEqual([]);
    expect(data).toEqual({
      firstName: "Laura",
      lastName: "Muster",
      email: "laura@example.com",
      birthDate: "1990-05-17",
      nationality: "DE",
    });
    // Never collected: document number (not configured for this property).
    expect(data).not.toHaveProperty("documentNumber");
  });

  it("reports invalid values without keeping them", () => {
    const { data, errors } = normalizeGuestInput(
      {
        firstName: "<script>",
        lastName: "M\u0000",
        birthDate: "2030-01-01",
        nationality: "XX",
        postalCode: "!!",
        city: "x".repeat(101),
      },
      fieldsForRole(config, "primary"),
      today,
    );
    expect(data).toEqual({});
    expect(errors.map((error) => error.field).sort()).toEqual(
      ["birthDate", "city", "firstName", "lastName", "nationality", "postalCode"].sort(),
    );
    expect(
      normalizeGuestInput({ birthDate: "2026-02-30" }, ["birthDate"], today).errors,
    ).toHaveLength(1);
  });
});

describe("children rules", () => {
  it("applies children rules by age at arrival", () => {
    expect(ageOn("2008-08-27", arrival)).toBe(18);
    expect(ageOn("2008-08-28", arrival)).toBe(17);
    // Children rules (+ the mobile number every traveller needs).
    expect(rulesFor(config, "companion", { birthDate: "2015-01-01" }, arrival).required).toEqual([
      "firstName",
      "lastName",
      "phone",
      "birthDate",
    ]);
    expect(rulesFor(config, "companion", { birthDate: "1980-01-01" }, arrival).required).toEqual([
      "firstName",
      "lastName",
      "phone",
      "birthDate",
      "nationality",
    ]);
    // Without a birth date the stricter adult rules apply.
    expect(rulesFor(config, "companion", {}, arrival).required).toContain("nationality");
    expect(
      missingFields(
        rulesFor(
          config,
          "companion",
          { firstName: "Mia", lastName: "M", birthDate: "2015-01-01" },
          arrival,
        ),
        {
          firstName: "Mia",
          lastName: "M",
          birthDate: "2015-01-01",
        },
      ),
    ).toEqual(["phone"]);
  });
});

describe("registration progress", () => {
  const contact = { email: "laura@example.com", phone: "+491701234567" };
  const primary: RegistrationGuest = {
    position: 0,
    role: "primary",
    data: {
      firstName: "Laura",
      lastName: "Muster",
      birthDate: "1990-05-17",
      nationality: "DE",
      ...contact,
    },
  };
  const address = { street: "Weg 1", postalCode: "87452", city: "Altusried", country: "DE" };

  it("counts all steps before anything is saved", () => {
    const result = assessRegistration(config, undefined, arrival);
    expect(result.stepsRemaining).toBe(4);
    expect(result.nextStep).toBe("trip");
    expect(result.readyToSubmit).toBe(false);
  });

  it("tracks guests, address and review", () => {
    const draft = { status: "draft" as const, guestCount: 1, guests: [primary] };
    const result = assessRegistration(config, draft, arrival);
    expect(result.steps).toEqual({
      trip: "complete",
      guests: "complete",
      address: "incomplete",
      review: "incomplete",
    });
    expect(result.nextStep).toBe("address");
    const complete = {
      ...draft,
      guests: [{ ...primary, data: { ...primary.data, ...address } }],
    };
    expect(assessRegistration(config, complete, arrival)).toMatchObject({
      readyToSubmit: true,
      nextStep: "review",
      stepsRemaining: 1,
    });
    expect(
      assessRegistration(config, { ...complete, status: "submitted" }, arrival).stepsRemaining,
    ).toBe(0);
  });

  it("requires the main guest's e-mail and phone", () => {
    const noPhone = { ...primary, data: { ...primary.data, phone: undefined } };
    delete noPhone.data.phone;
    expect(
      assessRegistration(config, { status: "draft", guestCount: 1, guests: [noPhone] }, arrival)
        .steps.guests,
    ).toBe("incomplete");
    expect(guestMissingFields(config, 0, noPhone.data, arrival)).toEqual(["phone"]);
  });

  it("requires every traveller up to the guest count, each with a mobile number", () => {
    const withAddress = { ...primary, data: { ...primary.data, ...address } };
    const mia = {
      position: 1,
      role: "companion" as const,
      data: { firstName: "Mia", lastName: "M", birthDate: "2015-01-01" },
    };
    const tom = {
      position: 2,
      role: "companion" as const,
      data: { firstName: "Tom", lastName: "M", birthDate: "1985-01-01", nationality: "AT" },
    };
    const draft = { status: "draft" as const, guestCount: 3, guests: [withAddress, mia, tom] };
    // A fellow traveller without a mobile number blocks completion.
    expect(assessRegistration(config, draft, arrival).steps.guests).toBe("incomplete");
    expect(assessRegistration(config, draft, arrival).readyToSubmit).toBe(false);
    const full = {
      ...draft,
      guests: [
        withAddress,
        { ...mia, data: { ...mia.data, phone: "+436641234567" } },
        { ...tom, data: { ...tom.data, phone: "+491709876543" } },
      ],
    };
    expect(assessRegistration(config, full, arrival).readyToSubmit).toBe(true);
    // No e-mail required for fellow travellers.
    expect(guestStepFields(config, 1)).not.toContain("email");
    expect(guestStepFields(config, 0)).toContain("email");
  });

  it("has no address step when the property asks for no address data", () => {
    const minimal = {
      ...config,
      primaryGuest: { required: ["firstName", "lastName"] as const, optional: [] },
    };
    const result = assessRegistration(
      minimal,
      {
        status: "draft",
        guestCount: 1,
        guests: [
          { position: 0, role: "primary", data: { firstName: "A", lastName: "B", ...contact } },
        ],
      },
      arrival,
    );
    expect(result.steps.address).toBe("skipped");
    expect(result.readyToSubmit).toBe(true);
  });
});

describe("sync retry policy", () => {
  const now = new Date("2026-08-01T10:00:00Z");
  it("backs off and gives up after the maximum attempts", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(99)).toBe(6 * 60 * 60_000);
    expect(nextSyncState({ status: "retry", code: "timeout" }, 1, now)).toEqual({
      status: "retry_required",
      nextAttemptAt: new Date(now.getTime() + 60_000),
      errorCode: "timeout",
    });
    expect(nextSyncState({ status: "retry", code: "timeout" }, 8, now)).toEqual({
      status: "failed",
      errorCode: "timeout",
    });
    expect(nextSyncState({ status: "failed", code: "rejected" }, 1, now).status).toBe("failed");
    expect(nextSyncState({ status: "synced" }, 3, now)).toEqual({ status: "synced" });
  });
});
