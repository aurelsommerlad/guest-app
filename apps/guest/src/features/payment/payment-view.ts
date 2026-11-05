import { type PaymentEvaluation, type PaymentState, resolveLocalizedText } from "@up/core";

import { type Locale, routing } from "../../i18n/routing";

/** What the payment overview renders – formatted for one locale. Pure. */
export type PaymentView = {
  state: PaymentState;
  /** "29. Dezember 2026, 16:00" */
  dueAt?: string;
  freeCancellationUntil?: string;
  lines: readonly { id: string; name: string; date?: string; amount: string }[];
  payments: readonly {
    id: string;
    label?: string;
    date?: string;
    amount: string;
    pending: boolean;
  }[];
  refunds: readonly { id: string; date?: string; amount: string; pending: boolean }[];
  totals?: {
    charged: string;
    paid: string;
    open: string;
    pending?: string;
    refunded?: string;
    credit?: string;
  };
  thirdParty: boolean;
};

export function buildPaymentView(
  evaluation: PaymentEvaluation,
  locale: Locale,
  timeZone: string,
): PaymentView {
  const currency = evaluation.currency ?? "EUR";
  const money = new Intl.NumberFormat(locale, { style: "currency", currency });
  const instant = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  const day = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const instantDay = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone });
  const serviceDay = (isoDate?: string) =>
    isoDate && /^\d{4}-\d{2}-\d{2}$/.test(isoDate)
      ? day.format(new Date(`${isoDate}T00:00:00Z`))
      : undefined;
  const at = (iso?: string) => (iso ? instantDay.format(new Date(iso)) : undefined);
  const optional = (value: number) => (value > 0 ? money.format(value) : undefined);
  const { totals } = evaluation;
  const folios = evaluation.folios;
  return {
    state: evaluation.state,
    ...(evaluation.dueAt ? { dueAt: instant.format(new Date(evaluation.dueAt)) } : {}),
    ...(evaluation.freeCancellationUntil
      ? { freeCancellationUntil: instant.format(new Date(evaluation.freeCancellationUntil)) }
      : {}),
    lines: folios.flatMap((folio) =>
      folio.charges.map((charge) => {
        const date = serviceDay(charge.serviceDate);
        return {
          id: `${folio.id}/${charge.id}`,
          name: resolveLocalizedText(charge.name, locale, routing.defaultLocale),
          ...(date ? { date } : {}),
          amount: money.format(charge.gross.amount),
        };
      }),
    ),
    payments: folios.flatMap((folio) =>
      folio.payments
        .filter((payment) => payment.status === "success" || payment.status === "pending")
        .map((payment) => {
          const date = at(payment.at);
          return {
            id: `${folio.id}/${payment.id}`,
            ...(payment.method ? { label: payment.method } : {}),
            ...(date ? { date } : {}),
            amount: money.format(payment.amount.amount),
            pending: payment.status === "pending",
          };
        }),
    ),
    refunds: folios.flatMap((folio) =>
      folio.refunds
        .filter((refund) => refund.status === "success" || refund.status === "pending")
        .map((refund) => {
          const date = at(refund.at);
          return {
            id: `${folio.id}/${refund.id}`,
            ...(date ? { date } : {}),
            amount: money.format(refund.amount.amount),
            pending: refund.status === "pending",
          };
        }),
    ),
    ...(totals
      ? {
          totals: {
            charged: money.format(totals.charged),
            paid: money.format(totals.paid),
            open: money.format(totals.open),
            ...(optional(totals.pending) ? { pending: money.format(totals.pending) } : {}),
            ...(optional(totals.refunded) ? { refunded: money.format(totals.refunded) } : {}),
            ...(optional(totals.credit) ? { credit: money.format(totals.credit) } : {}),
          },
        }
      : {}),
    thirdParty: evaluation.thirdParty,
  };
}
