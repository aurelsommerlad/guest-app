import { describe, expect, it } from "vitest";

import {
  CONTACT_FIELDS,
  FIELD_DATA_CLASS,
  LEGAL_FIELDS,
  splitGuestData,
} from "./data-classification";
import {
  configFromTemplate,
  DE_BMG_TEMPLATE,
  legalRequiredFields,
  registrationFormRequired,
} from "./legal-templates";
import { REGISTRATION_FIELDS } from "./registration-model";
import { responsibleAdultStatus } from "./responsible-adult";
import { resolveSharedAddresses, type SharedAddressGuest } from "./shared-address";

describe("responsible adult (≥ 18 at arrival, declaration only)", () => {
  it.each([
    ["2008-11-12", "2026-11-12", "declared-adult"], // 18th birthday on arrival day
    ["2008-11-13", "2026-11-12", "declared-under-age"], // one day too young
    ["2008-02-29", "2026-02-28", "declared-under-age"], // leap day: not yet 18
    ["2008-02-29", "2026-03-01", "declared-adult"],
    ["1980-05-01", "2026-11-12", "declared-adult"],
    ["2030-01-01", "2026-11-12", "invalid"], // future
    ["1890-01-01", "2026-11-12", "invalid"], // older than 120
    ["2026-13-01", "2026-11-12", "invalid"],
    [undefined, "2026-11-12", "missing"],
    ["  ", "2026-11-12", "missing"],
  ] as const)("%s on %s → %s", (birthDate, arrival, expected) => {
    expect(responsibleAdultStatus(birthDate, arrival)).toBe(expected);
  });

  it("honours a configured minimum age", () => {
    expect(responsibleAdultStatus("2009-01-01", "2026-11-12", 16)).toBe("declared-adult");
  });

  it("never reports the age as verified", () => {
    expect(responsibleAdultStatus("1980-05-01", "2026-11-12")).not.toMatch(/verified/);
  });
});

describe("legal vs. contact data", () => {
  it("classifies every field exactly once", () => {
    expect(new Set(Object.keys(FIELD_DATA_CLASS))).toEqual(new Set(REGISTRATION_FIELDS));
    expect(LEGAL_FIELDS.length + CONTACT_FIELDS.length).toBe(REGISTRATION_FIELDS.length);
    expect(CONTACT_FIELDS).toEqual(["email", "phone"]);
  });

  it("splits a traveller's data; contact keeps the name to know whom it reaches", () => {
    const { legal, contact } = splitGuestData({
      firstName: "Anna",
      lastName: "Muster",
      email: "anna@example.org",
      phone: "+491701234567",
      birthDate: "1980-05-01",
      street: "Seestraße 12",
    });
    expect(legal).toEqual({
      firstName: "Anna",
      lastName: "Muster",
      birthDate: "1980-05-01",
      street: "Seestraße 12",
    });
    expect(contact).toEqual({
      firstName: "Anna",
      lastName: "Muster",
      email: "anna@example.org",
      phone: "+491701234567",
    });
  });
});

describe("shared address", () => {
  const primary: SharedAddressGuest = {
    position: 0,
    role: "primary",
    data: {
      firstName: "Anna",
      lastName: "Muster",
      street: "Seestraße 12",
      postalCode: "88131",
      city: "Lindau",
      country: "DE",
    },
  };
  const child: SharedAddressGuest = {
    position: 1,
    role: "companion",
    data: { firstName: "Ben", lastName: "Muster", street: "alt" },
    addressSource: "same-as-primary",
  };

  it("copies the main guest's current address", () => {
    const result = resolveSharedAddresses([primary, child], "allowed");
    expect(result.ok && result.guests[1]?.data).toEqual({
      firstName: "Ben",
      lastName: "Muster",
      street: "Seestraße 12",
      postalCode: "88131",
      city: "Lindau",
      country: "DE",
    });
    const second = result.ok ? result.guests[1] : undefined;
    expect(second && "addressSource" in second).toBe(false);
  });

  it("is refused where the policy does not allow it", () => {
    expect(resolveSharedAddresses([primary, child], "never")).toEqual({
      ok: false,
      error: "not-allowed",
      position: 1,
    });
  });

  it("needs a main guest address", () => {
    const empty = { ...primary, data: { firstName: "Anna", lastName: "Muster" } };
    expect(resolveSharedAddresses([empty, child], "allowed")).toMatchObject({
      ok: false,
      error: "primary-missing",
    });
  });

  it("leaves own addresses alone", () => {
    const own = { ...child, addressSource: "own" as const };
    const result = resolveSharedAddresses([primary, own], "allowed");
    expect(result.ok && result.guests[1]?.data.street).toBe("alt");
  });
});

describe("German registration template (draft, HØV and LÆKE)", () => {
  const arrival = "2026-11-12";

  it("is a draft for legal review with open checks for the municipalities", () => {
    expect(DE_BMG_TEMPLATE.reviewStatus).toBe("draft-legal-review");
    expect(DE_BMG_TEMPLATE.intendedPropertyIds).toEqual(["hov", "laeke"]);
    expect(DE_BMG_TEMPLATE.openChecks.map((check) => check.id)).toEqual(
      expect.arrayContaining(["de-kurtaxe-hov", "de-kurtaxe-laeke", "de-family-exemption"]),
    );
  });

  it("German main guest: no document data, but birth date and address", () => {
    const fields = legalRequiredFields(
      DE_BMG_TEMPLATE,
      { position: 0, data: { nationality: "DE" } },
      arrival,
    );
    expect(fields).toContain("birthDate");
    expect(fields).toContain("street");
    expect(fields).not.toContain("documentNumber");
    expect(registrationFormRequired(DE_BMG_TEMPLATE, "DE")).toBe(false);
  });

  it("foreign main guest: document data required", () => {
    const fields = legalRequiredFields(
      DE_BMG_TEMPLATE,
      { position: 0, data: { nationality: "AT" } },
      arrival,
    );
    expect(fields).toEqual(expect.arrayContaining(["documentType", "documentNumber"]));
    expect(registrationFormRequired(DE_BMG_TEMPLATE, "AT")).toBe(true);
  });

  it("unknown nationality: the stricter set applies", () => {
    expect(legalRequiredFields(DE_BMG_TEMPLATE, { position: 0, data: {} }, arrival)).toContain(
      "documentNumber",
    );
    expect(registrationFormRequired(DE_BMG_TEMPLATE, undefined)).toBe(true);
  });

  it("companions: adults vs. minors", () => {
    const adult = legalRequiredFields(
      DE_BMG_TEMPLATE,
      { position: 1, data: { nationality: "FR", birthDate: "1985-01-01" } },
      arrival,
    );
    expect(adult).toContain("documentNumber");
    const minor = legalRequiredFields(
      DE_BMG_TEMPLATE,
      { position: 1, data: { nationality: "FR", birthDate: "2015-01-01" } },
      arrival,
    );
    expect(minor).toEqual(["firstName", "lastName", "birthDate", "nationality"]);
    const german = legalRequiredFields(
      DE_BMG_TEMPLATE,
      { position: 1, data: { nationality: "DE" } },
      arrival,
    );
    expect(german).toEqual(["firstName", "lastName"]);
  });

  it("builds a valid, disabled configuration candidate", () => {
    const config = configFromTemplate(DE_BMG_TEMPLATE, {
      targets: [],
      providerSettings: {},
      guestCardRelevant: false,
    });
    expect(config.enabled).toBe(false);
    expect(config.country).toBe("DE");
    expect(config.primaryGuest.optional).toEqual(["documentType", "documentNumber"]);
    expect(config.children?.underAge).toBe(18);
  });
});
