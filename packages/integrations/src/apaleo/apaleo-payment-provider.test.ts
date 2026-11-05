import { evaluatePayment, PmsError } from "@up/core";
import { describe, expect, it } from "vitest";

import { createApaleoPaymentProvider } from "./apaleo-payment-provider";
import {
  CLIENT_ID,
  CLIENT_SECRET,
  capturingLogger,
  jsonResponse,
  scriptedFetch,
  tokenResponse,
} from "./test-helpers";

/** Trimmed payloads in the shape of the Apaleo TEST booking JTKQSYFX (read 2026-11-05). */
const reservation = {
  id: "JTKQSYFX-1",
  bookingId: "JTKQSYFX",
  status: "Confirmed",
  arrival: "2027-01-12T16:00:00+01:00",
  departure: "2027-01-14T10:00:00+01:00",
  ratePlan: { id: "TEST-STD_NO_BF-IGL4", code: "STD_NO_BF" },
  channelCode: "Direct",
  guaranteeType: "CreditCard",
  hasActivePaymentAccount: false,
  primaryGuest: { firstName: "Aurel", lastName: "Sommerlad", email: "guest@example.com" },
  cancellationFee: {
    code: "FLEX",
    dueDateTime: "2026-12-29T16:00:00+01:00",
    fee: { amount: 198, currency: "EUR" },
  },
  balance: { amount: -337, currency: "EUR" },
  payableAmount: { guest: { amount: 337, currency: "EUR" } },
};
const charge = (id: string, amount: number, serviceDate: string, en = "IGL No. 4") => ({
  id,
  serviceType: "Accommodation",
  name: en,
  translatedNames: { de: en === "IGL No. 4" ? en : "Endreinigung bei Abreise", en },
  isPosted: false,
  serviceDate,
  quantity: 1,
  type: "TimeSlice",
  amount: { grossAmount: amount, netAmount: amount / 1.07, vatPercent: 7, currency: "EUR" },
});
const guestFolio = {
  id: "JTKQSYFX-1-1",
  type: "Guest",
  status: "Open",
  debitor: {
    type: "PrimaryGuest",
    firstName: "Aurel",
    name: "Sommerlad",
    email: "guest@example.com",
    address: { addressLine1: "Musterweg 1", city: "Lindau" },
  },
  isMainFolio: true,
  isEmpty: false,
  balance: { amount: -337, currency: "EUR" },
  charges: [
    charge("JTKQSYFX-1-TS-1", 99, "2027-01-12"),
    charge("JTKQSYFX-1-TS-2", 99, "2027-01-13"),
    charge("JTKQSYFX-1-ES-1", 139, "2027-01-13", "Final cleaning on departure"),
  ],
};
const bookingFolio = {
  id: "JTKQSYFX-TEST-1",
  type: "Booking",
  status: "Open",
  debitor: { type: "Booker", name: "Sommerlad" },
  isMainFolio: false,
  isEmpty: true,
  balance: { amount: 0, currency: "EUR" },
};
const noContent = () => new Response(null, { status: 204 });

function setup(handlers: Parameters<typeof scriptedFetch>[0]) {
  const { fetchFn, calls } = scriptedFetch(handlers);
  const { logger, lines } = capturingLogger();
  const provider = createApaleoPaymentProvider({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    logger,
    fetch: fetchFn,
    retryDelayMs: 0,
    timeoutMs: 1_000,
  });
  return { provider, calls, lines };
}

describe("ApaleoPaymentProvider (read-only)", () => {
  it("reads reservation, own and booking folios, payments and refunds – GET only", async () => {
    const { provider, calls } = setup([
      () => tokenResponse(),
      () => jsonResponse(reservation),
      () => jsonResponse({ folios: [guestFolio], count: 1 }),
      () => jsonResponse({ folios: [bookingFolio], count: 1 }),
      noContent,
      noContent,
    ]);
    const summary = await provider.getPaymentSummary("JTKQSYFX-1");

    const api = calls.slice(1);
    expect(api.map((call) => call.init?.method)).toEqual(["GET", "GET", "GET", "GET", "GET"]);
    expect(api.map((call) => new URL(call.url).pathname + new URL(call.url).search)).toEqual([
      "/booking/v1/reservations/JTKQSYFX-1",
      "/finance/v1/folios?reservationIds=JTKQSYFX-1&expand=charges&pageSize=500",
      "/finance/v1/folios?bookingIds=JTKQSYFX&type=Booking&pageSize=500",
      "/finance/v1/folios/JTKQSYFX-1-1/payments?pageSize=500",
      "/finance/v1/folios/JTKQSYFX-1-1/refunds?pageSize=500",
    ]);

    expect(summary.reservation).toEqual({
      status: "confirmed",
      arrivalAt: "2027-01-12T16:00:00+01:00",
      departureAt: "2027-01-14T10:00:00+01:00",
      freeCancellationUntil: "2026-12-29T16:00:00+01:00",
      ratePlanId: "TEST-STD_NO_BF-IGL4",
      guaranteeType: "CreditCard",
      channelCode: "Direct",
      payableByGuest: { amount: 337, currency: "EUR" },
    });
    expect(summary.folios.map((folio) => [folio.id, folio.kind, folio.debitor])).toEqual([
      ["JTKQSYFX-1-1", "guest", "primary-guest"],
      ["JTKQSYFX-TEST-1", "booking", "booker"],
    ]);
    expect(summary.folios[0]?.charges[2]).toMatchObject({
      name: { de: "Endreinigung bei Abreise", en: "Final cleaning on departure" },
      gross: { amount: 139, currency: "EUR" },
      posted: false,
      elsewhere: false,
    });

    // End to end with the business rules: 337 € open, due from 29.12.2026 16:00.
    const evaluation = evaluatePayment(
      summary,
      { mode: "inform", due: { rule: "at-free-cancellation-end" }, otaWithoutSignal: "review" },
      new Date("2026-11-05T12:00:00Z"),
    );
    expect(evaluation).toMatchObject({ state: "not-due", totals: { open: 337, charged: 337 } });
  });

  it("never keeps personal data (names, e-mail, address) of debitors or guests", async () => {
    const { provider } = setup([
      () => tokenResponse(),
      () => jsonResponse(reservation),
      () => jsonResponse({ folios: [guestFolio], count: 1 }),
      noContent,
      noContent,
      noContent,
    ]);
    const text = JSON.stringify(await provider.getPaymentSummary("JTKQSYFX-1"));
    for (const secret of ["Sommerlad", "Aurel", "guest@example.com", "Musterweg"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("maps payments, refunds and moved transactions", async () => {
    const { provider } = setup([
      () => tokenResponse(),
      () => jsonResponse(reservation),
      () =>
        jsonResponse({
          folios: [{ ...guestFolio, balance: { amount: 0, currency: "EUR" } }],
          count: 1,
        }),
      noContent,
      () =>
        jsonResponse({
          payments: [
            {
              id: "P1",
              status: "Success",
              type: "PaymentLink",
              method: "Visa",
              amount: { amount: 337, currency: "EUR" },
              paymentDate: "2026-12-30T10:00:00Z",
              externalReference: { pspReference: "psp-123", merchantReference: "m" },
            },
            {
              id: "P2",
              status: "Success",
              amount: { amount: 20, currency: "EUR" },
              movedTo: { id: "OTHER-1" },
            },
          ],
          count: 2,
        }),
      () =>
        jsonResponse({
          refunds: [{ id: "R1", status: "Pending", amount: { amount: 5, currency: "EUR" } }],
          count: 1,
        }),
    ]);
    const summary = await provider.getPaymentSummary("JTKQSYFX-1");
    const [folio] = summary.folios;
    expect(folio?.payments).toEqual([
      {
        id: "P1",
        status: "success",
        amount: { amount: 337, currency: "EUR" },
        method: "Visa",
        type: "PaymentLink",
        at: "2026-12-30T10:00:00Z",
        elsewhere: false,
      },
      { id: "P2", status: "success", amount: { amount: 20, currency: "EUR" }, elsewhere: true },
    ]);
    expect(JSON.stringify(summary)).not.toContain("psp-123");
    expect(folio?.refunds).toEqual([
      { id: "R1", status: "pending", amount: { amount: 5, currency: "EUR" }, elsewhere: false },
    ]);
  });

  it("does not read payments of company / third-party folios", async () => {
    const companyFolio = {
      ...guestFolio,
      id: "JTKQSYFX-1-2",
      isMainFolio: false,
      debitor: { type: "Company", name: "Muster GmbH" },
      company: { id: "MUSTER" },
    };
    const { provider, calls } = setup([
      () => tokenResponse(),
      () => jsonResponse(reservation),
      () => jsonResponse({ folios: [guestFolio, companyFolio], count: 2 }),
      noContent,
      noContent,
      noContent,
    ]);
    const summary = await provider.getPaymentSummary("JTKQSYFX-1");
    expect(calls.some((call) => call.url.includes("JTKQSYFX-1-2/"))).toBe(false);
    expect(summary.folios[1]).toMatchObject({ debitor: "company", hasCompany: true });
  });

  it("missing scope (403) fails as auth – callers treat it as unknown, never as paid", async () => {
    const { provider } = setup([
      () => tokenResponse(),
      () => jsonResponse(reservation),
      () => jsonResponse({ messages: ["forbidden"] }, 403),
    ]);
    const error = await provider.getPaymentSummary("JTKQSYFX-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PmsError);
    expect((error as PmsError).kind).toBe("auth");
  });

  it("an incomplete page is not used (would undercount payments)", async () => {
    const { provider } = setup([
      () => tokenResponse(),
      () => jsonResponse(reservation),
      () => jsonResponse({ folios: [guestFolio], count: 2 }),
    ]);
    const error = await provider.getPaymentSummary("JTKQSYFX-1").catch((e: unknown) => e);
    expect((error as PmsError).kind).toBe("invalid-response");
  });

  it("an unexpected payload is invalid – logged with field paths only", async () => {
    const { provider, lines } = setup([
      () => tokenResponse(),
      () => jsonResponse({ ...reservation, status: "Whatever" }),
    ]);
    const error = await provider.getPaymentSummary("JTKQSYFX-1").catch((e: unknown) => e);
    expect((error as PmsError).kind).toBe("invalid-response");
    expect(lines.join("\n")).not.toContain("Sommerlad");
  });

  it("rejects malformed reservation ids without calling Apaleo", async () => {
    const { provider, calls } = setup([]);
    const error = await provider.getPaymentSummary("../folios").catch((e: unknown) => e);
    expect((error as PmsError).kind).toBe("not-found");
    expect(calls).toHaveLength(0);
  });
});
