import {
  createLogger,
  type PaymentConfig,
  type PaymentProvider,
  type PaymentSummary,
  PAYMENTS_OFF,
  PmsError,
} from "@up/core";
import { describe, expect, it } from "vitest";

import { findPropertyById } from "../../config/properties";
import { type GuestContext } from "../guest-context/guest-context";
import { loadPayment } from "./load-payment";
import { paymentObservationOf } from "./payment-observation";

const property = findPropertyById("test-run");
if (!property) throw new Error("test-run missing");
const context: GuestContext = {
  mode: "guest",
  tenantId: "unique-places",
  propertyId: "test-run",
  unitId: "test-ap-1",
  reservationProvider: "apaleo",
  externalReservationId: "JTKQSYFX-1",
  property,
  now: new Date("2026-12-30T09:00:00+01:00"),
  reservation: { status: "unavailable" },
};
const inform: PaymentConfig = {
  mode: "inform",
  due: { rule: "at-free-cancellation-end" },
  otaWithoutSignal: "review",
};
const summary: PaymentSummary = {
  reservation: {
    status: "confirmed",
    arrivalAt: "2027-01-12T16:00:00+01:00",
    departureAt: "2027-01-14T10:00:00+01:00",
    freeCancellationUntil: "2026-12-29T16:00:00+01:00",
    channelCode: "Direct",
  },
  folios: [
    {
      id: "F",
      kind: "guest",
      debitor: "primary-guest",
      hasCompany: false,
      isMain: true,
      isEmpty: false,
      closed: false,
      balance: { amount: -337, currency: "EUR" },
      charges: [],
      payments: [],
      refunds: [],
    },
  ],
};
const provider = (impl: PaymentProvider["getPaymentSummary"]): PaymentProvider => ({
  name: "stub",
  getPaymentSummary: impl,
});
function logs() {
  const lines: string[] = [];
  return { lines, logger: createLogger({ sink: (_level, line) => lines.push(line) }) };
}

describe("loadPayment", () => {
  it("payments off: no statement at all, the provider is not called", async () => {
    let called = false;
    const { logger } = logs();
    const result = await loadPayment(
      {
        config: PAYMENTS_OFF,
        provider: () =>
          provider(() => {
            called = true;
            return Promise.resolve(summary);
          }),
        logger,
      },
      context,
    );
    expect(result).toBeUndefined();
    expect(called).toBe(false);
  });

  it("evaluates live provider data for the guest's own reservation", async () => {
    const asked: string[] = [];
    const { logger } = logs();
    const result = await loadPayment(
      {
        config: inform,
        provider: () =>
          provider((id) => {
            asked.push(id);
            return Promise.resolve(summary);
          }),
        logger,
      },
      context,
    );
    expect(asked).toEqual(["JTKQSYFX-1"]);
    expect(result?.evaluation).toMatchObject({ state: "due", totals: { open: 337 } });
  });

  it("a provider failure (e.g. missing scope) is unknown – never paid – and logs no data", async () => {
    const { logger, lines } = logs();
    const result = await loadPayment(
      {
        config: inform,
        provider: () =>
          provider(() =>
            Promise.reject(
              new PmsError("auth", "Apaleo responded with 403", { provider: "apaleo" }),
            ),
          ),
        logger,
      },
      context,
    );
    expect(result?.evaluation.state).toBe("unknown");
    expect(lines.join("\n")).toContain('"kind":"auth"');
    expect(lines.join("\n")).not.toContain("JTKQSYFX");
  });

  it("no provider for the reservation (e.g. mock preview): unknown", async () => {
    const { logger } = logs();
    const result = await loadPayment(
      { config: inform, provider: () => undefined, logger },
      context,
    );
    expect(result?.evaluation.state).toBe("unknown");
  });
});

describe("recording the check (Phase 12 B1)", () => {
  const paidSummary: PaymentSummary = {
    ...summary,
    folios: summary.folios.map((folio) => ({
      ...folio,
      balance: { amount: 0, currency: "EUR" },
      payments: [
        {
          id: "P-1",
          status: "success",
          amount: { amount: 337, currency: "EUR" },
          elsewhere: false,
        },
        {
          id: "P-2",
          status: "failure",
          amount: { amount: 337, currency: "EUR" },
          elsewhere: false,
        },
      ],
    })),
  };

  it("records state and real check instant; a confirmed payment with its payment ids", async () => {
    const { logger } = logs();
    const recorded: { state: string; at: string; confirmed?: unknown }[] = [];
    const result = await loadPayment(
      {
        config: inform,
        provider: () => provider(() => Promise.resolve(paidSummary)),
        record: (guest, evaluation, observedAt) => {
          const observation = paymentObservationOf(guest, evaluation, observedAt);
          recorded.push({
            state: observation.state,
            at: observedAt.toISOString(),
            confirmed: observation.confirmed,
          });
          return Promise.resolve({ clearedAt: observedAt.toISOString() });
        },
        clock: () => new Date("2026-12-30T10:05:00Z"),
        logger,
      },
      context,
    );
    expect(recorded).toEqual([
      {
        state: "paid",
        at: "2026-12-30T10:05:00.000Z",
        confirmed: { amountMinor: 33700, currency: "EUR", providerPaymentIds: ["P-1"] },
      },
    ]);
    expect(result?.clearedAt).toBe("2026-12-30T10:05:00.000Z");
  });

  it("unknown, due or pending are recorded – never as confirmed", async () => {
    const { logger } = logs();
    for (const impl of [
      () => Promise.reject(new PmsError("timeout", "t", { provider: "apaleo" })),
      () => Promise.resolve(summary),
    ]) {
      let confirmed: unknown = "not called";
      await loadPayment(
        {
          config: inform,
          provider: () => provider(impl),
          record: (guest, evaluation, observedAt) => {
            confirmed = paymentObservationOf(guest, evaluation, observedAt).confirmed;
            return Promise.resolve({});
          },
          logger,
        },
        context,
      );
      expect(confirmed).toBeUndefined();
    }
  });

  it("a database error while recording never breaks the page or changes the state", async () => {
    const { logger, lines } = logs();
    const result = await loadPayment(
      {
        config: inform,
        provider: () => provider(() => Promise.resolve(summary)),
        record: () => Promise.reject(new Error("db down")),
        logger,
      },
      context,
    );
    expect(result?.evaluation.state).toBe("due");
    expect(result?.clearedAt).toBeUndefined();
    expect(lines.join("\n")).toContain("payment state could not be recorded");
  });
});
