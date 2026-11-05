/**
 * Plan for handing a company invoice recipient to the PMS (ADR 0021) – pure, no I/O.
 *
 * The plan is computed for every folio of the booking but only the main guest's own, open
 * guest folios without any invoice may ever be written. Everything else is skipped or left to
 * staff. Existing invoices are never changed (a correction is a cancellation and re-issue in
 * the PMS, done by accounting). The reservation's primary guest is never touched – the
 * recipient lives on the folio only.
 *
 * Write-back is OFF by default; with it off the plan is a dry run ("would apply").
 * Integration (Apaleo `PATCH /finance/v1/folios/{id}`, scopes folios.read, invoices.read,
 * folios.manage) is phase C7.
 */
import { createHash } from "node:crypto";

import { type CompanyBillingAddress } from "./billing-address";

export const BILLING_FOLIO_KINDS = ["guest", "booking", "house", "external", "other"] as const;
export type BillingFolioKind = (typeof BILLING_FOLIO_KINDS)[number];

/** Who the folio is currently addressed to. */
export const BILLING_DEBITOR_KINDS = ["guest", "company", "other"] as const;
export type BillingDebitorKind = (typeof BILLING_DEBITOR_KINDS)[number];

/** Provider-neutral facts about one folio, read just before planning. */
export type BillingFolioFacts = {
  folioId: string;
  reservationId?: string;
  kind: BillingFolioKind;
  closed: boolean;
  /** Any invoice (also cancelled or paid) exists for the folio. */
  hasInvoices: boolean;
  /** The PMS allows changing the recipient address (Apaleo: allowedActions ChangeAddress). */
  addressChangeAllowed: boolean;
  debitor: BillingDebitorKind;
  /** Fingerprint of the recipient we last wrote to this folio (from our sync record). */
  appliedFingerprint?: string;
};

export const BILLING_PLAN_ACTIONS = [
  "apply",
  "already-applied",
  "skip-invoiced",
  "skip-closed",
  "skip-address-change-not-allowed",
  "manual-not-guest-folio",
  "manual-other-reservation",
  "manual-third-party-debitor",
] as const;
export type BillingPlanAction = (typeof BILLING_PLAN_ACTIONS)[number];

export type BillingFolioPlan = {
  folioId: string;
  action: BillingPlanAction;
  /** True only for "apply" with write-back enabled. */
  executable: boolean;
};

export type BillingTransferPlan = {
  fingerprint: string;
  writeBackEnabled: boolean;
  folios: BillingFolioPlan[];
  /** A person has to look at it (invoice exists, foreign folio, no addressable folio, …). */
  needsStaff: boolean;
};

/** Stable fingerprint of the recipient (company data only; order-independent). */
export function billingFingerprint(billing: CompanyBillingAddress): string {
  const canonical = JSON.stringify([
    billing.companyName,
    billing.street,
    billing.postalCode ?? "",
    billing.city,
    billing.country,
    billing.vatId ?? "",
    billing.contactPerson?.firstName ?? "",
    billing.contactPerson?.lastName ?? "",
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

const STAFF_ACTIONS: ReadonlySet<BillingPlanAction> = new Set([
  "skip-invoiced",
  "skip-closed",
  "skip-address-change-not-allowed",
  "manual-not-guest-folio",
  "manual-other-reservation",
  "manual-third-party-debitor",
]);

function actionFor(
  folio: BillingFolioFacts,
  reservationId: string,
  fingerprint: string,
): BillingPlanAction {
  // Order matters: an invoice always wins – nothing on an invoiced folio is touched.
  if (folio.hasInvoices) return "skip-invoiced";
  if (folio.reservationId !== reservationId) return "manual-other-reservation";
  if (folio.kind !== "guest") return "manual-not-guest-folio";
  if (folio.closed) return "skip-closed";
  if (folio.appliedFingerprint === fingerprint) return "already-applied";
  // A company/third party set by staff (not by us) is never overwritten.
  if (folio.debitor !== "guest" && folio.appliedFingerprint === undefined) {
    return "manual-third-party-debitor";
  }
  if (!folio.addressChangeAllowed) return "skip-address-change-not-allowed";
  return "apply";
}

export function planBillingTransfer(input: {
  billing: CompanyBillingAddress;
  reservationId: string;
  folios: readonly BillingFolioFacts[];
  writeBackEnabled: boolean;
}): BillingTransferPlan {
  const fingerprint = billingFingerprint(input.billing);
  const folios = input.folios.map((folio) => {
    const action = actionFor(folio, input.reservationId, fingerprint);
    return {
      folioId: folio.folioId,
      action,
      executable: action === "apply" && input.writeBackEnabled,
    };
  });
  return {
    fingerprint,
    writeBackEnabled: input.writeBackEnabled,
    folios,
    // Also when there is no folio we could address at all.
    needsStaff:
      folios.some((folio) => STAFF_ACTIONS.has(folio.action)) ||
      !folios.some((folio) => folio.action === "apply" || folio.action === "already-applied"),
  };
}
