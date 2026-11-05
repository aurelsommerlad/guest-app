/**
 * Invoice recipient chosen in the check-in (ADR 0021).
 *
 * - private (default): the invoice goes to the main guest's registration address.
 * - company: the company is the invoice recipient. The guest may be named as contact person
 *   but does not remain the recipient.
 *
 * Stored and validated independently of the registration address – choosing "company" never
 * changes the private registration data.
 */
import { z } from "zod";

import { addressIssues, type AddressFieldIssue } from "../address/address-check";
import { normalizePostalCode } from "../address/postal-codes";
import { checkVatIdFormat } from "./vat-id";

export const BILLING_KINDS = ["private", "company"] as const;
export type BillingKind = (typeof BILLING_KINDS)[number];

export type CompanyBillingAddress = {
  kind: "company";
  companyName: string;
  street: string;
  postalCode?: string;
  city: string;
  country: string;
  /** Normalised (e.g. "DE123456789"); optional. */
  vatId?: string;
  /** Optional "z. Hd." – never the recipient. */
  contactPerson?: { firstName: string; lastName: string };
};

export type BillingChoice = { kind: "private" } | CompanyBillingAddress;

export const DEFAULT_BILLING_CHOICE: BillingChoice = { kind: "private" };

export type BillingFieldIssue =
  | AddressFieldIssue
  | {
      field: "companyName" | "vatId" | "contactPerson";
      code: "required" | "invalid" | "invalid-format";
    };

function text(max: number) {
  return z
    .string()
    .transform((value) => value.normalize("NFC").replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(1)
        .max(max)
        .regex(/^[^\p{Cc}<>]+$/u),
    );
}
const companyName = text(200);
const personName = text(100);

function optionalString(raw: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Raw form values → billing choice. Anything but "company" is the private default. Errors are
 * reported per field; nothing invalid is returned as a value.
 */
export function normalizeBillingInput(
  raw: Readonly<Record<string, unknown>>,
): { ok: true; billing: BillingChoice } | { ok: false; issues: BillingFieldIssue[] } {
  if (raw["billingKind"] !== "company") return { ok: true, billing: DEFAULT_BILLING_CHOICE };
  const issues: BillingFieldIssue[] = [];

  const nameRaw = optionalString(raw, "companyName");
  const name = nameRaw === undefined ? undefined : companyName.safeParse(nameRaw.slice(0, 400));
  if (!name) issues.push({ field: "companyName", code: "required" });
  else if (!name.success) issues.push({ field: "companyName", code: "invalid" });

  const clean = (key: string) =>
    (optionalString(raw, key) ?? "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 300);
  const address = {
    street: clean("street"),
    postalCode: clean("postalCode") === "" ? undefined : normalizePostalCode(clean("postalCode")),
    city: clean("city"),
    country: clean("country").toUpperCase(),
  };
  issues.push(...addressIssues(address));

  let vatId: string | undefined;
  const vatRaw = optionalString(raw, "vatId");
  if (vatRaw !== undefined) {
    const format = checkVatIdFormat(vatRaw.slice(0, 40));
    if (format.ok) vatId = format.normalized;
    else issues.push({ field: "vatId", code: "invalid-format" });
  }

  let contactPerson: CompanyBillingAddress["contactPerson"];
  const first = optionalString(raw, "contactFirstName");
  const last = optionalString(raw, "contactLastName");
  if (first !== undefined || last !== undefined) {
    const f = personName.safeParse((first ?? "").slice(0, 200));
    const l = personName.safeParse((last ?? "").slice(0, 200));
    if (f.success && l.success) contactPerson = { firstName: f.data, lastName: l.data };
    else issues.push({ field: "contactPerson", code: "invalid" });
  }

  if (issues.length > 0 || !name?.success) return { ok: false, issues };
  return {
    ok: true,
    billing: {
      kind: "company",
      companyName: name.data,
      street: address.street,
      ...(address.postalCode ? { postalCode: address.postalCode } : {}),
      city: address.city,
      country: address.country,
      ...(vatId ? { vatId } : {}),
      ...(contactPerson ? { contactPerson } : {}),
    },
  };
}
