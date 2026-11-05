import { describe, expect, it } from "vitest";

import { type CompanyBillingAddress, normalizeBillingInput } from "./billing-address";
import {
  billingFingerprint,
  type BillingFolioFacts,
  planBillingTransfer,
} from "./billing-transfer";
import { checkVatIdFormat, normalizeVatId, vatIdStatus } from "./vat-id";

describe("VAT id format", () => {
  it.each([
    ["DE 123 456 789", true],
    ["ATU12345678", true],
    ["AT12345678", false],
    ["NL123456789B01", true],
    ["FR AB123456789", true],
    ["EL123456789", true],
    ["CHE-123.456.789 MWST", true],
    ["DE12345678", false],
    ["XX123", false],
    ["", false],
  ])("%s → %s", (value, ok) => {
    expect(checkVatIdFormat(value).ok).toBe(ok);
  });

  it("normalises and knows which ids VIES can check", () => {
    expect(normalizeVatId("de 123.456-789")).toBe("DE123456789");
    expect(checkVatIdFormat("DE123456789")).toMatchObject({ viesCheckable: true });
    expect(checkVatIdFormat("CHE123456789")).toMatchObject({ viesCheckable: false });
  });

  it("status: VIES outage never turns into invalid", () => {
    const de = checkVatIdFormat("DE123456789");
    expect(vatIdStatus(undefined)).toBe("not-provided");
    expect(vatIdStatus(checkVatIdFormat("DE1"))).toBe("format-invalid");
    expect(vatIdStatus(de)).toBe("format-valid");
    expect(vatIdStatus(de, { ok: false })).toBe("vies-unavailable");
    expect(vatIdStatus(de, { ok: true, valid: true })).toBe("vies-valid");
    expect(vatIdStatus(de, { ok: true, valid: false })).toBe("vies-invalid");
    expect(vatIdStatus(checkVatIdFormat("CHE123456789"))).toBe("not-checkable");
  });
});

describe("billing input", () => {
  const company = {
    billingKind: "company",
    companyName: "  Muster   GmbH ",
    street: "Industriestraße 4",
    postalCode: "6900",
    city: "Bregenz",
    country: "at",
  };

  it("defaults to private", () => {
    expect(normalizeBillingInput({})).toEqual({ ok: true, billing: { kind: "private" } });
    expect(normalizeBillingInput({ billingKind: "bogus", companyName: "X" })).toEqual({
      ok: true,
      billing: { kind: "private" },
    });
  });

  it("company: the company is the recipient, guest only optional contact", () => {
    const result = normalizeBillingInput({
      ...company,
      vatId: "atu 12345678",
      contactFirstName: "Anna",
      contactLastName: "Muster",
    });
    expect(result).toEqual({
      ok: true,
      billing: {
        kind: "company",
        companyName: "Muster GmbH",
        street: "Industriestraße 4",
        postalCode: "6900",
        city: "Bregenz",
        country: "AT",
        vatId: "ATU12345678",
        contactPerson: { firstName: "Anna", lastName: "Muster" },
      },
    });
  });

  it("all company fields are required, VAT id optional", () => {
    const result = normalizeBillingInput({ billingKind: "company" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(["companyName", "street", "city", "country"]),
    );
    expect(normalizeBillingInput(company).ok).toBe(true);
  });

  it("rejects a malformed VAT id, wrong postal code, half a contact person", () => {
    const bad = normalizeBillingInput({
      ...company,
      vatId: "AT123",
      postalCode: "88131",
      contactFirstName: "Anna",
    });
    expect(!bad.ok && bad.issues).toEqual(
      expect.arrayContaining([
        { field: "vatId", code: "invalid-format" },
        { field: "postalCode", code: "invalid-format" },
        { field: "contactPerson", code: "invalid" },
      ]),
    );
  });
});

describe("planBillingTransfer (no writes, dry run by default)", () => {
  const billing: CompanyBillingAddress = {
    kind: "company",
    companyName: "Muster GmbH",
    street: "Industriestraße 4",
    postalCode: "6900",
    city: "Bregenz",
    country: "AT",
  };
  const folio = (over: Partial<BillingFolioFacts> = {}): BillingFolioFacts => ({
    folioId: "F-1",
    reservationId: "R-1",
    kind: "guest",
    closed: false,
    hasInvoices: false,
    addressChangeAllowed: true,
    debitor: "guest",
    ...over,
  });
  const plan = (folios: BillingFolioFacts[], writeBackEnabled = false) =>
    planBillingTransfer({ billing, reservationId: "R-1", folios, writeBackEnabled });

  it("own open guest folio without invoice → apply, but not executable while write-back is off", () => {
    expect(plan([folio()])).toMatchObject({
      writeBackEnabled: false,
      needsStaff: false,
      folios: [{ folioId: "F-1", action: "apply", executable: false }],
    });
    expect(plan([folio()], true).folios[0]?.executable).toBe(true);
  });

  it("an existing invoice always wins – nothing is touched", () => {
    const result = plan([folio({ hasInvoices: true, closed: true, kind: "booking" })], true);
    expect(result.folios[0]).toEqual({
      folioId: "F-1",
      action: "skip-invoiced",
      executable: false,
    });
    expect(result.needsStaff).toBe(true);
  });

  it("several reservations and folios", () => {
    const result = plan(
      [
        folio({ folioId: "F-1" }),
        folio({ folioId: "F-2", hasInvoices: true }),
        folio({ folioId: "F-3", reservationId: "R-2" }),
        folio({ folioId: "F-4", kind: "booking", reservationId: "R-1" }),
        folio({ folioId: "F-5", closed: true }),
        folio({ folioId: "F-6", debitor: "company" }),
        folio({ folioId: "F-7", addressChangeAllowed: false }),
      ],
      true,
    );
    expect(result.folios.map((f) => [f.folioId, f.action, f.executable])).toEqual([
      ["F-1", "apply", true],
      ["F-2", "skip-invoiced", false],
      ["F-3", "manual-other-reservation", false],
      ["F-4", "manual-not-guest-folio", false],
      ["F-5", "skip-closed", false],
      ["F-6", "manual-third-party-debitor", false],
      ["F-7", "skip-address-change-not-allowed", false],
    ]);
    expect(result.needsStaff).toBe(true);
  });

  it("idempotent: a folio we already addressed with the same data is left alone", () => {
    const fingerprint = billingFingerprint(billing);
    const result = plan([folio({ debitor: "company", appliedFingerprint: fingerprint })], true);
    expect(result.folios[0]?.action).toBe("already-applied");
    // changed company data → our own earlier write may be updated
    const changed = plan([folio({ debitor: "company", appliedFingerprint: "0".repeat(64) })], true);
    expect(changed.folios[0]?.action).toBe("apply");
  });

  it("no folio at all needs staff", () => {
    expect(plan([]).needsStaff).toBe(true);
  });

  it("fingerprint changes with the recipient data only", () => {
    expect(billingFingerprint(billing)).toBe(billingFingerprint({ ...billing }));
    expect(billingFingerprint({ ...billing, vatId: "ATU12345678" })).not.toBe(
      billingFingerprint(billing),
    );
  });
});
