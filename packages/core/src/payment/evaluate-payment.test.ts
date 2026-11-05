import { describe, expect, it } from "vitest";

import {
  confirmsPayment,
  evaluatePayment,
  paymentAccessCondition,
  unknownPayment,
} from "./evaluate-payment";
import { type PaymentConfig } from "./payment-config";
import { type PaymentFolio, type PaymentSummary } from "./payment-summary";

/** Shape of the Apaleo TEST reservation JTKQSYFX-1 (read on 2026-11-05). */
const eur = (amount: number) => ({ amount, currency: "EUR" });
const charge = (id: string, amount: number, serviceDate: string) => ({
  id,
  name: { de: "IGL No. 4" },
  serviceDate,
  gross: eur(amount),
  posted: false,
  elsewhere: false,
});
const guestFolio = (overrides: Partial<PaymentFolio> = {}): PaymentFolio => ({
  id: "JTKQSYFX-1-1",
  kind: "guest",
  debitor: "primary-guest",
  hasCompany: false,
  isMain: true,
  isEmpty: false,
  closed: false,
  balance: eur(-337),
  charges: [
    charge("TS-1", 99, "2027-01-12"),
    charge("TS-2", 99, "2027-01-13"),
    charge("ES-1", 139, "2027-01-13"),
  ],
  payments: [],
  refunds: [],
  ...overrides,
});
const bookingFolio = (overrides: Partial<PaymentFolio> = {}): PaymentFolio => ({
  id: "JTKQSYFX-TEST-1",
  kind: "booking",
  debitor: "booker",
  hasCompany: false,
  isMain: false,
  isEmpty: true,
  closed: false,
  balance: eur(0),
  charges: [],
  payments: [],
  refunds: [],
  ...overrides,
});
const summary = (
  folios: PaymentFolio[] = [guestFolio(), bookingFolio()],
  reservation: Partial<PaymentSummary["reservation"]> = {},
): PaymentSummary => ({
  reservation: {
    status: "confirmed",
    arrivalAt: "2027-01-12T16:00:00+01:00",
    departureAt: "2027-01-14T10:00:00+01:00",
    freeCancellationUntil: "2026-12-29T16:00:00+01:00",
    ratePlanId: "TEST-STD_NO_BF-IGL4",
    guaranteeType: "CreditCard",
    channelCode: "Direct",
    payableByGuest: eur(337),
    ...reservation,
  },
  folios,
});
const config: PaymentConfig = {
  mode: "inform",
  due: { rule: "at-free-cancellation-end" },
  otaWithoutSignal: "review",
};
const before = new Date("2026-11-05T12:00:00+01:00");
const after = new Date("2026-12-30T09:00:00+01:00");
const success = (id: string, amount: number) => ({
  id,
  status: "success" as const,
  amount: eur(amount),
  elsewhere: false,
});

describe("evaluatePayment – TEST reservation JTKQSYFX-1", () => {
  it("before the free-cancellation end: 337 € open, not due yet, empty booking folio ignored", () => {
    const result = evaluatePayment(summary(), config, before);
    expect(result.state).toBe("not-due");
    expect(result.reasons).toEqual([]);
    expect(result.dueAt).toBe("2026-12-29T16:00:00+01:00");
    expect(result.totals).toEqual({
      charged: 337,
      paid: 0,
      pending: 0,
      refunded: 0,
      open: 337,
      credit: 0,
    });
    expect(result.folios.map((folio) => folio.id)).toEqual(["JTKQSYFX-1-1"]);
  });

  it("after it: the WHOLE open amount is due (not only the 198 € fee)", () => {
    const result = evaluatePayment(summary(), config, after);
    expect(result.state).toBe("due");
    expect(result.totals?.open).toBe(337);
  });

  it("without free cancellation (non-refundable) the amount is due at once", () => {
    expect(
      evaluatePayment(summary(undefined, { freeCancellationUntil: undefined }), config, before)
        .state,
    ).toBe("due");
  });
});

describe("evaluatePayment – amounts", () => {
  it("fully paid", () => {
    const folio = guestFolio({ balance: eur(0), payments: [success("P1", 337)] });
    const result = evaluatePayment(
      summary([folio, bookingFolio()], { payableByGuest: eur(0) }),
      config,
      after,
    );
    expect(result.state).toBe("paid");
    expect(result.totals).toMatchObject({ paid: 337, open: 0 });
    expect(confirmsPayment(result)).toBe(true);
  });

  it("partly paid: the rest stays due", () => {
    const folio = guestFolio({ balance: eur(-137), payments: [success("P1", 200)] });
    const result = evaluatePayment(summary([folio], { payableByGuest: eur(137) }), config, after);
    expect(result.state).toBe("due");
    expect(result.totals).toMatchObject({ paid: 200, open: 137 });
  });

  it("a payment in progress is pending – never paid", () => {
    const folio = guestFolio({
      payments: [{ id: "P1", status: "pending", amount: eur(337), elsewhere: false }],
    });
    const result = evaluatePayment(summary([folio]), config, after);
    expect(result.state).toBe("pending");
    expect(confirmsPayment(result)).toBe(false);
  });

  it("failed and canceled payments do not count", () => {
    const folio = guestFolio({
      payments: [
        { id: "P1", status: "failure", amount: eur(337), elsewhere: false },
        { id: "P2", status: "canceled", amount: eur(337), elsewhere: false },
      ],
    });
    expect(evaluatePayment(summary([folio]), config, after)).toMatchObject({
      state: "due",
      totals: { paid: 0, pending: 0, open: 337 },
    });
  });

  it("overpaid: credit (the team refunds), refunds are listed", () => {
    const folio = guestFolio({
      balance: eur(40),
      payments: [success("P1", 400), success("P2", 17)],
      refunds: [{ id: "R1", status: "success", amount: eur(40), elsewhere: false }],
    });
    const result = evaluatePayment(summary([folio], { payableByGuest: eur(0) }), config, after);
    expect(result.state).toBe("credit");
    expect(result.totals).toMatchObject({ credit: 40, refunded: 40, paid: 417 });
  });

  it("charges and payments moved/routed elsewhere are not counted here", () => {
    const folio = guestFolio({
      balance: eur(-238),
      charges: [
        charge("TS-1", 99, "2027-01-12"),
        { ...charge("ES-1", 139, "2027-01-13"), elsewhere: false },
        { ...charge("X", 50, "2027-01-13"), elsewhere: true },
      ],
      payments: [{ ...success("P1", 99), elsewhere: true }],
    });
    const result = evaluatePayment(summary([folio], { payableByGuest: eur(238) }), config, after);
    expect(result.totals).toMatchObject({ charged: 238, paid: 0, open: 238 });
    expect(result.folios[0]?.charges.map((item) => item.id)).toEqual(["TS-1", "ES-1"]);
  });

  it("not-yet-due services are part of the open amount but not due before the rule says so", () => {
    const rule: PaymentConfig = { ...config, due: { rule: "days-before-arrival", days: 7 } };
    expect(evaluatePayment(summary(), rule, after)).toMatchObject({
      state: "not-due",
      dueAt: "2027-01-05T15:00:00.000Z",
    });
    expect(evaluatePayment(summary(), rule, new Date("2027-01-06T00:00:00Z")).state).toBe("due");
  });

  it("a rate plan can have its own rule", () => {
    const perRate: PaymentConfig = {
      ...config,
      ratePlans: { "TEST-STD_NO_BF-IGL4": { rule: "at-booking" } },
    };
    expect(evaluatePayment(summary(), perRate, before).state).toBe("due");
  });

  it("nothing charged, nothing paid: not applicable", () => {
    const folio = guestFolio({ balance: eur(0), charges: [] });
    expect(evaluatePayment(summary([folio], { payableByGuest: eur(0) }), config, after).state).toBe(
      "not-applicable",
    );
  });
});

describe("evaluatePayment – folios and payers", () => {
  it("company / third-party folio: not counted, not shown, guest folio settled", () => {
    const company = guestFolio({
      id: "JTKQSYFX-1-2",
      debitor: "company",
      hasCompany: true,
      isMain: false,
      balance: eur(-300),
    });
    const guest = guestFolio({
      balance: eur(0),
      charges: [charge("MB", 37, "2027-01-13")],
      payments: [success("P1", 37)],
    });
    const result = evaluatePayment(
      summary([guest, company], { payableByGuest: eur(0) }),
      config,
      after,
    );
    expect(result.state).toBe("paid");
    expect(result.thirdParty).toBe(true);
    expect(result.folios.map((folio) => folio.id)).toEqual(["JTKQSYFX-1-1"]);
    expect(result.totals?.open).toBe(0);
  });

  it("several guest folios are summed", () => {
    const second = guestFolio({
      id: "JTKQSYFX-1-3",
      debitor: "additional-guest",
      isMain: false,
      balance: eur(-50),
      charges: [charge("EX", 50, "2027-01-13")],
    });
    const result = evaluatePayment(
      summary([guestFolio(), second], { payableByGuest: eur(387) }),
      config,
      after,
    );
    expect(result.totals).toMatchObject({ open: 387, charged: 387 });
    expect(result.folios).toHaveLength(2);
  });

  it("a booking folio with deposits goes to review (cannot be split between reservations)", () => {
    const deposit = bookingFolio({ isEmpty: false, balance: eur(100) });
    const result = evaluatePayment(summary([guestFolio(), deposit]), config, after);
    expect(result).toMatchObject({ state: "review", reasons: ["booking-folio"] });
  });

  it("mixed currencies and unknown debitors go to review", () => {
    const chf = guestFolio({ id: "B", balance: { amount: -10, currency: "CHF" } });
    expect(evaluatePayment(summary([guestFolio(), chf]), config, after).reasons).toContain(
      "currency-mix",
    );
    const anonymous = guestFolio({ debitor: undefined });
    expect(evaluatePayment(summary([anonymous]), config, after).reasons).toContain(
      "debitor-unknown",
    );
  });

  it("Apaleo's own payable figure disagreeing: review", () => {
    expect(
      evaluatePayment(summary(undefined, { payableByGuest: eur(198) }), config, after),
    ).toMatchObject({ state: "review", reasons: ["plausibility"] });
  });

  it("company guarantee with an open guest folio: review", () => {
    expect(
      evaluatePayment(summary(undefined, { guaranteeType: "Company" }), config, after).reasons,
    ).toContain("company-unclear");
  });
});

describe("evaluatePayment – OTA and reservation status", () => {
  it("virtual card or OTA guarantee: collected by the OTA – nothing to pay here", () => {
    expect(evaluatePayment(summary(undefined, { virtualCard: true }), config, after).state).toBe(
      "not-applicable",
    );
    expect(evaluatePayment(summary(undefined, { guaranteeType: "Ota" }), config, after).state).toBe(
      "not-applicable",
    );
  });

  it("OTA channel without a clear signal: review (configurable)", () => {
    const booking = summary(undefined, { channelCode: "BookingCom" });
    expect(evaluatePayment(booking, config, after).reasons).toContain("ota-unclear");
    expect(
      evaluatePayment(booking, { ...config, otaWithoutSignal: "not-applicable" }, after).state,
    ).toBe("due");
  });

  it("canceled or no-show: not applicable", () => {
    for (const status of ["canceled", "no-show"] as const) {
      expect(evaluatePayment(summary(undefined, { status }), config, after).state).toBe(
        "not-applicable",
      );
    }
  });
});

describe("payment condition for access (rules 2 and 3)", () => {
  const due = evaluatePayment(summary(), config, after);

  it("a due amount is outstanding; unverified states never count as paid", () => {
    expect(paymentAccessCondition(due, {})).toBe("outstanding");
    expect(paymentAccessCondition(unknownPayment(), {})).toBe("unverified");
    const pending = evaluatePayment(
      summary([
        guestFolio({
          payments: [{ id: "P", status: "pending", amount: eur(337), elsewhere: false }],
        }),
      ]),
      config,
      after,
    );
    expect(paymentAccessCondition(pending, {})).toBe("unverified");
    expect(paymentAccessCondition({ ...due, state: "review" }, {})).toBe("unverified");
  });

  it("once confirmed, later extras and a provider outage do not lock again", () => {
    const clearedAt = "2026-12-30T10:00:00Z";
    expect(paymentAccessCondition(due, { clearedAt })).toBe("satisfied");
    expect(paymentAccessCondition(unknownPayment(), { clearedAt })).toBe("satisfied");
  });

  it("not due, paid, credit and not applicable are satisfied", () => {
    for (const state of ["not-due", "paid", "credit", "not-applicable"] as const) {
      expect(paymentAccessCondition({ ...due, state }, {})).toBe("satisfied");
    }
  });

  it("only provider-confirmed settlement marks the reservation as cleared", () => {
    expect(confirmsPayment(due)).toBe(false);
    expect(confirmsPayment(unknownPayment())).toBe(false);
    const settledWithoutPayment = {
      ...due,
      state: "paid" as const,
      totals: { charged: 0, paid: 0, pending: 0, refunded: 0, open: 0, credit: 0 },
    };
    expect(confirmsPayment(settledWithoutPayment)).toBe(false);
  });
});
