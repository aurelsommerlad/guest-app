import { describe, expect, it } from "vitest";

import { assessAddress } from "../address/address-check";
import {
  billingStatus,
  type CheckInStatusInput,
  deriveCheckInStatus,
  legalRegistrationStatus,
} from "./check-in-status";
import {
  checkInValidationPolicySchema,
  DEFAULT_CHECK_IN_VALIDATION_POLICY,
} from "./validation-policy";

const home = { street: "Seestraße 12", postalCode: "88131", city: "Lindau", country: "DE" };

function input(over: Partial<CheckInStatusInput> = {}): CheckInStatusInput {
  return {
    policy: DEFAULT_CHECK_IN_VALIDATION_POLICY,
    dataComplete: true,
    age: "declared-adult",
    address: assessAddress(home),
    email: "verified",
    phone: "none",
    legal: { formRequired: false, targets: [], syncs: [] },
    billing: { kind: "private" },
    ...over,
  };
}

describe("validation policy", () => {
  it("defaults follow the decisions of 2026-11-05", () => {
    expect(checkInValidationPolicySchema.parse(DEFAULT_CHECK_IN_VALIDATION_POLICY)).toEqual(
      DEFAULT_CHECK_IN_VALIDATION_POLICY,
    );
    expect(DEFAULT_CHECK_IN_VALIDATION_POLICY).toMatchObject({
      emailVerification: "required",
      smsVerification: { mode: "off", supportedCountries: ["DE", "AT", "CH"] },
      responsibleAdultMinAge: 18,
      addressSuggestions: "google-places",
      billingWriteBack: false,
    });
  });

  it("billing write-back and mandatory SMS cannot be configured yet", () => {
    expect(
      checkInValidationPolicySchema.safeParse({
        ...DEFAULT_CHECK_IN_VALIDATION_POLICY,
        billingWriteBack: true,
      }).success,
    ).toBe(false);
    expect(
      checkInValidationPolicySchema.safeParse({
        ...DEFAULT_CHECK_IN_VALIDATION_POLICY,
        smsVerification: { mode: "required", supportedCountries: ["DE"] },
      }).success,
    ).toBe(false);
  });
});

describe("deriveCheckInStatus", () => {
  it("complete with data, adult declaration and confirmed e-mail", () => {
    const status = deriveCheckInStatus(input());
    expect(status.completeness).toBe("complete");
    expect(status.blockers).toEqual([]);
  });

  it("e-mail confirmation is required – pending/none/locked are not enough", () => {
    for (const email of ["none", "pending", "locked"] as const) {
      expect(deriveCheckInStatus(input({ email })).blockers).toEqual(["email-not-verified"]);
    }
  });

  it("a logged staff waiver satisfies it (and stays visible as 'waived')", () => {
    const status = deriveCheckInStatus(input({ email: "waived" }));
    expect(status.completeness).toBe("complete");
    expect(status.dimensions.email).toBe("waived");
  });

  it("main guest under age or without birth date blocks", () => {
    expect(deriveCheckInStatus(input({ age: "declared-under-age" })).blockers).toEqual([
      "responsible-person-under-age",
    ]);
    expect(deriveCheckInStatus(input({ age: "missing" })).blockers).toEqual([
      "responsible-person-age-missing",
    ]);
  });

  it("manual address, international phone, no SMS, pending identity check never block", () => {
    const status = deriveCheckInStatus(
      input({
        address: assessAddress({ street: "Ngong Road 5", city: "Nairobi", country: "KE" }),
        phone: "unsupported-country",
        policy: { ...DEFAULT_CHECK_IN_VALIDATION_POLICY, identityCheck: "on-site" },
      }),
    );
    expect(status.completeness).toBe("complete");
    expect(status.dimensions.identity).toBe("pending-on-site");
    expect(status.dimensions.phone).toBe("disabled"); // SMS is off
  });

  it("plausible data and confirmed contacts never mark identity, age or address as verified", () => {
    const status = deriveCheckInStatus(
      input({
        address: assessAddress(home, {
          kind: "provider-validation",
          granularity: "premise",
          complete: true,
          corrected: false,
          standardized: home,
        }),
        email: "verified",
        phone: "verified",
      }),
    );
    expect(status.dimensions.address).toBe("postally-plausible");
    expect(status.dimensions.age).toBe("declared-adult");
    expect(status.dimensions.identity).toBe("not-required");
    expect(JSON.stringify(status.dimensions)).not.toMatch(/"(address|age|identity)":"verified"/);
  });

  it("identity only by a staff record", () => {
    const status = deriveCheckInStatus(
      input({
        identity: {
          checkedByAdminUserId: "adm-1",
          checkedAt: new Date(),
          documentType: "passport",
        },
      }),
    );
    expect(status.dimensions.identity).toBe("checked-by-staff");
  });

  it("e-mail off → dimension disabled, not blocking", () => {
    const status = deriveCheckInStatus(
      input({
        email: "none",
        policy: { ...DEFAULT_CHECK_IN_VALIDATION_POLICY, emailVerification: "off" },
      }),
    );
    expect(status.completeness).toBe("complete");
    expect(status.dimensions.email).toBe("disabled");
  });

  it("incomplete data blocks", () => {
    expect(deriveCheckInStatus(input({ dataComplete: false })).blockers).toContain(
      "data-incomplete",
    );
  });
});

describe("legal registration status", () => {
  it("not required / manual without targets / manual for unimplemented targets", () => {
    expect(legalRegistrationStatus({ formRequired: false, targets: ["feratel"], syncs: [] })).toBe(
      "not-required",
    );
    expect(legalRegistrationStatus({ formRequired: true, targets: [], syncs: [] })).toBe("manual");
    expect(
      legalRegistrationStatus({
        formRequired: true,
        targets: ["feratel"],
        syncs: [{ target: "feratel", status: "pending", implemented: false }],
      }),
    ).toBe("manual");
  });

  it("follows the sync rows", () => {
    const row = (status: "pending" | "synced" | "failed") => ({
      target: "apaleo" as const,
      status,
      implemented: true,
    });
    const base = { formRequired: true, targets: ["apaleo" as const] };
    expect(legalRegistrationStatus({ ...base, syncs: [] })).toBe("pending");
    expect(legalRegistrationStatus({ ...base, syncs: [row("synced")] })).toBe("submitted");
    expect(legalRegistrationStatus({ ...base, syncs: [row("failed")] })).toBe("failed");
  });
});

describe("billing status", () => {
  it("maps folio plans", () => {
    expect(billingStatus({ kind: "private" })).toBe("private");
    expect(billingStatus({ kind: "company" })).toBe("company-pending");
    expect(billingStatus({ kind: "company", folioActions: ["apply"] })).toBe("company-pending");
    expect(billingStatus({ kind: "company", folioActions: ["already-applied"] })).toBe(
      "company-applied",
    );
    expect(
      billingStatus({ kind: "company", folioActions: ["already-applied", "skip-invoiced"] }),
    ).toBe("company-manual");
    expect(billingStatus({ kind: "company", folioActions: ["failed", "apply"] })).toBe(
      "company-failed",
    );
  });
});
