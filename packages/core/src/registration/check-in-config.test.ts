import { describe, expect, it } from "vitest";

import { DEFAULT_CHECK_IN_VALIDATION_POLICY } from "../check-in-status/validation-policy";
import { AT_MELDEG_TEMPLATE, configFromTemplate, DE_BMG_TEMPLATE } from "./legal-templates";
import { type PropertyRegistrationConfig, type RegistrationGuest } from "./registration-model";
import {
  assessRegistration,
  fieldsForRole,
  guestMissingFields,
  normalizeGuestInput,
  propertyRegistrationConfigSchema,
  responsibleAdultError,
  rulesFor,
} from "./registration-rules";

const arrival = "2026-12-20";
const today = "2026-11-06";

const base: PropertyRegistrationConfig = {
  enabled: true,
  country: "AT",
  targets: [],
  primaryGuest: { required: ["firstName", "lastName"], optional: [] },
  companions: { required: ["firstName", "lastName"], optional: [] },
  guestCardRelevant: true,
  providerSettings: {},
};
const validation = {
  ...DEFAULT_CHECK_IN_VALIDATION_POLICY,
  emailVerification: "optional" as const,
};
const at: PropertyRegistrationConfig = { ...base, legalTemplate: "at-meldeg", validation };
const de: PropertyRegistrationConfig = {
  ...base,
  country: "DE",
  legalTemplate: "de-bmg",
  validation,
};

const primaryData = {
  firstName: "Lea",
  lastName: "Beispiel",
  email: "lea@example.org",
  phone: "+436641234567",
  birthDate: "1985-02-02",
  nationality: "AT",
  street: "Dorfstraße 1",
  postalCode: "6793",
  city: "Gaschurn",
  country: "AT",
};

describe("configuration (schema)", () => {
  it("accepts template, validation policy and contact retention – all optional", () => {
    expect(propertyRegistrationConfigSchema.safeParse(base).success).toBe(true);
    expect(
      propertyRegistrationConfigSchema.safeParse({ ...at, contactRetentionDaysAfterDeparture: 30 })
        .success,
    ).toBe(true);
    expect(
      propertyRegistrationConfigSchema.safeParse({ ...base, legalTemplate: "xx" }).success,
    ).toBe(false);
    expect(
      propertyRegistrationConfigSchema.safeParse({
        ...at,
        validation: { ...validation, billingWriteBack: true },
      }).success,
    ).toBe(false);
  });

  it("template candidates validate against the schema", () => {
    for (const template of [DE_BMG_TEMPLATE, AT_MELDEG_TEMPLATE]) {
      const candidate = configFromTemplate(template, {
        targets: [],
        providerSettings: {},
        guestCardRelevant: false,
      });
      expect(propertyRegistrationConfigSchema.safeParse(candidate).success).toBe(true);
      expect(candidate.enabled).toBe(false);
    }
  });
});

describe("rules with a country template", () => {
  it("AT: every traveller needs birth date and residence; foreigners a document", () => {
    expect(fieldsForRole(at, "companion")).toEqual(
      expect.arrayContaining(["birthDate", "street", "country", "documentNumber"]),
    );
    const austrian = rulesFor(
      at,
      "companion",
      { nationality: "AT", birthDate: "1990-01-01" },
      arrival,
    );
    expect(austrian.required).toEqual(expect.arrayContaining(["birthDate", "street", "city"]));
    expect(austrian.required).not.toContain("documentNumber");
    const german = rulesFor(
      at,
      "companion",
      { nationality: "DE", birthDate: "1990-01-01" },
      arrival,
    );
    expect(german.required).toContain("documentNumber");
    const child = rulesFor(
      at,
      "companion",
      { nationality: "DE", birthDate: "2018-01-01" },
      arrival,
    );
    expect(child.required).not.toContain("documentNumber");
  });

  it("DE: German main guest needs no document, foreign main guest does", () => {
    expect(rulesFor(de, "primary", { nationality: "DE" }, arrival).required).not.toContain(
      "documentNumber",
    );
    expect(rulesFor(de, "primary", { nationality: "FR" }, arrival).required).toContain(
      "documentNumber",
    );
  });

  it("countries without postal codes do not require one", () => {
    expect(rulesFor(at, "primary", { country: "HK" }, arrival).required).not.toContain(
      "postalCode",
    );
    expect(rulesFor(at, "primary", { country: "DE" }, arrival).required).toContain("postalCode");
  });

  it("a validation policy makes the main guest's birth date required", () => {
    expect(rulesFor(base, "primary", {}, arrival).required).not.toContain("birthDate");
    expect(rulesFor({ ...base, validation }, "primary", {}, arrival).required).toContain(
      "birthDate",
    );
    expect(fieldsForRole({ ...base, validation }, "primary")).toContain("birthDate");
  });
});

describe("postal code against the country", () => {
  it("rejects a German code for Austria and accepts the right one", () => {
    const fields = ["street", "postalCode", "city", "country"] as const;
    const wrong = normalizeGuestInput(
      { street: "Dorfstraße 1", postalCode: "88131", city: "Gaschurn", country: "AT" },
      fields,
      today,
    );
    expect(wrong.errors).toEqual([{ field: "postalCode", code: "invalid-postal-code" }]);
    expect(wrong.data.postalCode).toBeUndefined();
    const right = normalizeGuestInput(
      { street: "Dorfstraße 1", postalCode: "6793", city: "Gaschurn", country: "AT" },
      fields,
      today,
    );
    expect(right.errors).toEqual([]);
  });

  it("countries without known pattern only get the generic check", () => {
    const result = normalizeGuestInput(
      { postalCode: "00100", country: "KE" },
      ["postalCode", "country"],
      today,
    );
    expect(result.errors).toEqual([]);
  });
});

describe("responsible adult (server-side)", () => {
  it("under 18 on the arrival day is an error; 18th birthday on arrival is fine", () => {
    expect(responsibleAdultError(at, { birthDate: "2008-12-21" }, arrival)).toEqual({
      field: "birthDate",
      code: "responsible-under-age",
    });
    expect(responsibleAdultError(at, { birthDate: "2008-12-20" }, arrival)).toBeUndefined();
    expect(responsibleAdultError(at, { birthDate: "1890-01-01" }, arrival)).toEqual({
      field: "birthDate",
      code: "invalid",
    });
    expect(responsibleAdultError(base, { birthDate: "2015-01-01" }, arrival)).toBeUndefined();
  });

  it("an under-age main guest keeps the guests step incomplete; minor companions are fine", () => {
    const companion: RegistrationGuest = {
      position: 1,
      role: "companion",
      addressSource: "same-as-primary",
      data: {
        firstName: "Max",
        lastName: "Beispiel",
        phone: "+436641234568",
        birthDate: "2018-07-07",
        nationality: "AT",
      },
    };
    const adult = { position: 0, role: "primary" as const, data: primaryData };
    const ok = assessRegistration(
      at,
      { status: "draft", guestCount: 2, guests: [adult, companion] },
      arrival,
    );
    expect(ok.steps.guests).toBe("complete");
    const minorLead = { ...adult, data: { ...primaryData, birthDate: "2010-01-01" } };
    const blocked = assessRegistration(
      at,
      { status: "draft", guestCount: 2, guests: [minorLead, companion] },
      arrival,
    );
    expect(blocked.steps.guests).toBe("incomplete");
  });
});

describe("shared address for fellow travellers", () => {
  const companionData = {
    firstName: "Max",
    lastName: "Beispiel",
    phone: "+436641234568",
    birthDate: "1990-07-07",
    nationality: "AT",
  };

  it("same-as-primary needs no own address when the policy allows it", () => {
    expect(guestMissingFields(at, 1, companionData, arrival, "same-as-primary")).toEqual([]);
    expect(guestMissingFields(at, 1, companionData, arrival, "own")).toEqual(
      expect.arrayContaining(["street", "postalCode", "city", "country"]),
    );
  });

  it("is ignored where the policy forbids it", () => {
    const never = { ...at, validation: { ...validation, sharedAddress: "never" as const } };
    expect(guestMissingFields(never, 1, companionData, arrival, "same-as-primary")).toEqual(
      expect.arrayContaining(["street"]),
    );
  });
});

describe("billing step", () => {
  it("is skipped unless company billing is enabled, complete once a choice is saved", () => {
    const guests = [{ position: 0, role: "primary" as const, data: primaryData }];
    expect(
      assessRegistration(base, { status: "draft", guestCount: 1, guests }, arrival).steps.billing,
    ).toBe("skipped");
    const open = assessRegistration(at, { status: "draft", guestCount: 1, guests }, arrival);
    expect(open.steps.billing).toBe("incomplete");
    expect(open.readyToSubmit).toBe(false);
    const chosen = assessRegistration(
      at,
      { status: "draft", guestCount: 1, guests, billing: { kind: "private" } },
      arrival,
    );
    expect(chosen.steps.billing).toBe("complete");
    expect(chosen.readyToSubmit).toBe(true);
  });
});
