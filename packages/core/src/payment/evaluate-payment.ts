import { type PaymentConfig, type PaymentDueRule } from "./payment-config";
import {
  type DebitorKind,
  type FolioCharge,
  type FolioPayment,
  type FolioRefund,
  type Money,
  type PaymentFolio,
  type PaymentSummary,
} from "./payment-summary";

/**
 * Payment state of one reservation, computed on the server from authoritative provider data
 * (Phase 12, ADR 0018). Pure – `now` is injected. Never decides on data from the browser.
 *
 * - not-applicable: nothing for the guest to pay through the app (third party, OTA, canceled)
 * - not-due: an amount is open, but not due yet
 * - due: an amount is open and due
 * - pending: a payment is being processed by the provider
 * - paid: the guest folios are settled
 * - credit: the guest paid more than owed (refund is handled by the team)
 * - review: the data is ambiguous – the team decides, the app never guesses
 * - unknown: the provider could not be read
 */
export type PaymentState =
  "not-applicable" | "not-due" | "due" | "pending" | "paid" | "credit" | "review" | "unknown";

export type PaymentReviewReason =
  | "booking-folio"
  | "currency-mix"
  | "debitor-unknown"
  | "company-unclear"
  | "ota-unclear"
  | "plausibility";

export type PaymentTotals = {
  /** All charges on the guest folios (posted and not yet posted). */
  charged: number;
  /** Confirmed payments. */
  paid: number;
  /** Payments still being processed. */
  pending: number;
  /** Confirmed refunds. */
  refunded: number;
  /** Owed by the guest (negative folio balances). */
  open: number;
  /** Paid in excess (positive folio balances). */
  credit: number;
};

export type PaymentEvaluation = {
  state: PaymentState;
  reasons: readonly PaymentReviewReason[];
  currency?: string;
  totals?: PaymentTotals;
  /** When the open amount becomes due; undefined while due/not applicable: due already. */
  dueAt?: string;
  freeCancellationUntil?: string;
  /** Guest folios as shown to the guest (third-party and booking folios are not shown). */
  folios: readonly {
    id: string;
    charges: readonly FolioCharge[];
    payments: readonly FolioPayment[];
    refunds: readonly FolioRefund[];
  }[];
  /** Part of the stay is billed to a company / third party (shown as a neutral note). */
  thirdParty: boolean;
};

const GUEST_DEBITORS = new Set<DebitorKind>(["primary-guest", "booker", "additional-guest"]);
const DIRECT_CHANNELS = new Set(["Direct", "Ibe"]);

/** Cent-exact arithmetic on major units. */
const cents = (amount: number) => Math.round(amount * 100);
const fromCents = (value: number) => value / 100;

function isGuestFolio(folio: PaymentFolio): boolean {
  return (
    folio.kind === "guest" &&
    !folio.hasCompany &&
    folio.debitor !== undefined &&
    GUEST_DEBITORS.has(folio.debitor)
  );
}

function isThirdPartyFolio(folio: PaymentFolio): boolean {
  return folio.kind === "guest" && (folio.hasCompany || folio.debitor === "company");
}

/** The applicable due rule: per rate plan, else the property default. */
export function dueRuleFor(config: PaymentConfig, ratePlanId: string | undefined): PaymentDueRule {
  return (ratePlanId && config.ratePlans?.[ratePlanId]) || config.due;
}

/** When the open amount is due (undefined = due already, e.g. no free cancellation). */
export function paymentDueAt(
  rule: PaymentDueRule,
  reservation: PaymentSummary["reservation"],
): string | undefined {
  switch (rule.rule) {
    case "at-booking":
      return undefined;
    case "at-free-cancellation-end":
      return reservation.freeCancellationUntil;
    case "days-before-arrival":
      return new Date(Date.parse(reservation.arrivalAt) - rule.days * 86_400_000).toISOString();
  }
}

const sum = (
  items: readonly { amount: Money; elsewhere: boolean; status: string }[],
  status: string,
) =>
  items
    .filter((item) => !item.elsewhere && item.status === status)
    .reduce((total, item) => total + cents(item.amount.amount), 0);

export function evaluatePayment(
  summary: PaymentSummary,
  config: PaymentConfig,
  now: Date,
): PaymentEvaluation {
  const { reservation } = summary;
  const guestFolios = summary.folios.filter(isGuestFolio);
  const thirdParty = summary.folios.some(isThirdPartyFolio);
  const reasons = new Set<PaymentReviewReason>();

  if (summary.folios.some((folio) => folio.kind === "guest" && folio.debitor === undefined)) {
    reasons.add("debitor-unknown");
  }
  // The booking's own folio (deposits) cannot be split between several reservations.
  if (summary.folios.some((folio) => folio.kind === "booking" && !folio.isEmpty)) {
    reasons.add("booking-folio");
  }
  const currencies = new Set(guestFolios.map((folio) => folio.balance.currency));
  if (currencies.size > 1) reasons.add("currency-mix");
  const [currency] = currencies;

  let charged = 0;
  let open = 0;
  let credit = 0;
  let paid = 0;
  let pending = 0;
  let refunded = 0;
  for (const folio of guestFolios) {
    const balance = cents(folio.balance.amount);
    if (balance < 0) open += -balance;
    if (balance > 0) credit += balance;
    charged += folio.charges
      .filter((charge) => !charge.elsewhere)
      .reduce((total, charge) => total + cents(charge.gross.amount), 0);
    paid += sum(folio.payments, "success");
    pending += sum(folio.payments, "pending");
    refunded += sum(folio.refunds, "success");
  }
  const totals: PaymentTotals = {
    charged: fromCents(charged),
    paid: fromCents(paid),
    pending: fromCents(pending),
    refunded: fromCents(refunded),
    open: fromCents(open),
    credit: fromCents(credit),
  };

  const dueAt = paymentDueAt(dueRuleFor(config, reservation.ratePlanId), reservation);
  const result = (state: PaymentState): PaymentEvaluation => ({
    state,
    reasons: [...reasons],
    ...(currency ? { currency } : {}),
    totals,
    ...(dueAt ? { dueAt } : {}),
    ...(reservation.freeCancellationUntil
      ? { freeCancellationUntil: reservation.freeCancellationUntil }
      : {}),
    folios: guestFolios.map((folio) => ({
      id: folio.id,
      charges: folio.charges.filter((charge) => !charge.elsewhere),
      payments: folio.payments.filter((payment) => !payment.elsewhere),
      refunds: folio.refunds.filter((refund) => !refund.elsewhere),
    })),
    thirdParty,
  });

  // Canceled / no-show: nothing is paid through the app (a credit is the team's to refund).
  if (reservation.status === "canceled" || reservation.status === "no-show") {
    return result("not-applicable");
  }
  // Collected by the OTA (virtual card or OTA guarantee): the guest does not pay us.
  if (reservation.virtualCard || reservation.guaranteeType === "Ota") {
    return result("not-applicable");
  }
  if (
    reservation.channelCode &&
    !DIRECT_CHANNELS.has(reservation.channelCode) &&
    config.otaWithoutSignal === "review"
  ) {
    reasons.add("ota-unclear");
  }
  if ((reservation.guaranteeType === "Company" || reservation.hasCompany) && open > 0) {
    reasons.add("company-unclear");
  }
  // Plausibility against Apaleo's own (undocumented) figure – only when it is comparable.
  if (
    reservation.payableByGuest &&
    !thirdParty &&
    reasons.size === 0 &&
    reservation.payableByGuest.currency === currency &&
    Math.abs(cents(reservation.payableByGuest.amount) - open) > 1
  ) {
    reasons.add("plausibility");
  }

  if (reasons.size > 0) return result("review");
  if (guestFolios.length === 0) return result("not-applicable");
  if (open === 0) {
    if (credit > 0) return result("credit");
    return result(charged > 0 || paid > 0 ? "paid" : "not-applicable");
  }
  if (pending > 0) return result("pending");
  if (dueAt && now.getTime() < Date.parse(dueAt)) return result("not-due");
  return result("due");
}

/** The provider could not be read: the state is unknown – never "paid". */
export function unknownPayment(): PaymentEvaluation {
  return { state: "unknown", reasons: [], folios: [], thirdParty: false };
}

/**
 * Whether the payment condition for access is met (used by the access policy, Phase C):
 * - satisfied: nothing (more) to pay – or payment was confirmed before (`clearedAt`)
 * - outstanding: a due amount is open
 * - unverified: processing, ambiguous or unknown – never treated as paid
 *
 * Business rules (2026-11-05): a confirmed payment stays confirmed – later extras and a
 * temporary provider outage do not lock access again; unverified payments never release.
 */
export type PaymentAccessCondition = "satisfied" | "outstanding" | "unverified";

export function paymentAccessCondition(
  evaluation: PaymentEvaluation,
  state: { clearedAt?: string },
): PaymentAccessCondition {
  if (state.clearedAt) return "satisfied";
  switch (evaluation.state) {
    case "paid":
    case "credit":
    case "not-applicable":
    case "not-due":
      return "satisfied";
    case "due":
      return "outstanding";
    case "pending":
    case "review":
    case "unknown":
      return "unverified";
  }
}

/** Only provider-confirmed settlement records the "cleared" instant. */
export function confirmsPayment(evaluation: PaymentEvaluation): boolean {
  return (
    (evaluation.state === "paid" || evaluation.state === "credit") &&
    (evaluation.totals?.paid ?? 0) > 0
  );
}
