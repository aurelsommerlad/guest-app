import { type PaymentEvaluation } from "@up/core";
import { describe, expect, it } from "vitest";

import { buildPaymentView } from "./payment-view";

const evaluation: PaymentEvaluation = {
  state: "not-due",
  reasons: [],
  currency: "EUR",
  dueAt: "2026-12-29T16:00:00+01:00",
  freeCancellationUntil: "2026-12-29T16:00:00+01:00",
  totals: { charged: 337, paid: 0, pending: 0, refunded: 0, open: 337, credit: 0 },
  folios: [
    {
      id: "F1",
      charges: [
        {
          id: "TS-1",
          name: { de: "IGL No. 4" },
          serviceDate: "2027-01-12",
          gross: { amount: 99, currency: "EUR" },
          posted: false,
          elsewhere: false,
        },
        {
          id: "ES-1",
          name: { de: "Endreinigung bei Abreise", en: "Final cleaning on departure" },
          serviceDate: "2027-01-13",
          gross: { amount: 139, currency: "EUR" },
          posted: false,
          elsewhere: false,
        },
      ],
      payments: [
        {
          id: "P1",
          status: "success",
          amount: { amount: 50, currency: "EUR" },
          method: "Visa",
          at: "2026-11-01T10:00:00Z",
          elsewhere: false,
        },
        { id: "P2", status: "failure", amount: { amount: 50, currency: "EUR" }, elsewhere: false },
        { id: "P3", status: "pending", amount: { amount: 20, currency: "EUR" }, elsewhere: false },
      ],
      refunds: [],
    },
  ],
  thirdParty: false,
};
const normalize = (value: string) => value.replace(/\s/g, " ");

describe("buildPaymentView", () => {
  it("formats amounts, dates and names in German (property time zone)", () => {
    const view = buildPaymentView(evaluation, "de", "Europe/Berlin");
    expect(normalize(view.dueAt ?? "")).toBe("29. Dezember 2026 um 16:00");
    expect(view.lines.map((line) => [line.name, line.date, normalize(line.amount)])).toEqual([
      ["IGL No. 4", "12. Jan.", "99,00 €"],
      ["Endreinigung bei Abreise", "13. Jan.", "139,00 €"],
    ]);
    expect(normalize(view.totals?.open ?? "")).toBe("337,00 €");
    expect(view.totals?.pending).toBeUndefined();
  });

  it("formats in English and falls back to German names", () => {
    const view = buildPaymentView(evaluation, "en", "Europe/Berlin");
    expect(view.lines.map((line) => line.name)).toEqual([
      "IGL No. 4",
      "Final cleaning on departure",
    ]);
    expect(view.totals?.open).toBe("€337.00");
  });

  it("lists confirmed and pending payments only – failed attempts are not shown", () => {
    const view = buildPaymentView(evaluation, "de", "Europe/Berlin");
    expect(view.payments.map((payment) => [payment.id, payment.label, payment.pending])).toEqual([
      ["F1/P1", "Visa", false],
      ["F1/P3", undefined, true],
    ]);
  });
});
