import {
  type DebitorKind,
  type FolioCharge,
  type FolioKind,
  type FolioPayment,
  type FolioRefund,
  type Logger,
  type PaymentFolio,
  type PaymentProvider,
  type PaymentStatus,
  type PaymentSummary,
  PmsError,
} from "@up/core";
import { z } from "zod";

import { ApaleoClient, type ApaleoClientOptions } from "./apaleo-client";

/**
 * Read-only Apaleo payment data (Phase 12 A, ADR 0018). Verified endpoints (Finance v1 /
 * Booking v1 OpenAPI, 2026-11-05) – all GET, nothing is written:
 * - GET /booking/v1/reservations/{id}                      scope reservations.read
 * - GET /finance/v1/folios?reservationIds=…&expand=charges scope folios.read
 * - GET /finance/v1/folios?bookingIds=…&type=Booking       scope folios.read
 * - GET /finance/v1/folios/{folioId}/payments              scope folios.read
 * - GET /finance/v1/folios/{folioId}/refunds               scope folios.read
 * Personal data (debitor names, addresses, card details) is not parsed – zod strips it.
 */

const money = z.object({ amount: z.number(), currency: z.string().min(3).max(3) });
const ref = z.object({ id: z.string() }).optional();

const reservationSchema = z.object({
  id: z.string(),
  bookingId: z.string(),
  status: z.enum(["Confirmed", "InHouse", "CheckedOut", "Canceled", "NoShow"]),
  arrival: z.string(),
  departure: z.string(),
  ratePlan: z.object({ id: z.string() }).optional(),
  guaranteeType: z.string().optional(),
  channelCode: z.string().optional(),
  paymentAccount: z.object({ isVirtual: z.boolean().optional() }).optional(),
  company: z.object({ id: z.string() }).optional(),
  cancellationFee: z.object({ dueDateTime: z.string().optional() }).optional(),
  payableAmount: z.object({ guest: money.optional() }).optional(),
});

const chargeSchema = z.object({
  id: z.string(),
  name: z.string(),
  translatedNames: z.record(z.string(), z.string()).optional(),
  serviceType: z.string().optional(),
  serviceDate: z.string().optional(),
  isPosted: z.boolean(),
  quantity: z.number().optional(),
  amount: z.object({ grossAmount: z.number(), currency: z.string() }),
  movedTo: ref,
  routedTo: ref,
});

const folioSchema = z.object({
  id: z.string(),
  type: z.enum(["House", "Guest", "External", "Booking"]),
  status: z.enum(["Open", "Closed", "ClosedWithInvoice"]),
  debitor: z
    .object({ type: z.enum(["Booker", "PrimaryGuest", "Company", "AdditionalGuest", "Property"]) })
    .optional(),
  company: z.object({ id: z.string().optional() }).optional(),
  isMainFolio: z.boolean().optional(),
  isEmpty: z.boolean().optional(),
  balance: money,
  charges: z.array(chargeSchema).optional(),
});
const folioListSchema = z.object({ folios: z.array(folioSchema), count: z.number() });

const statusSchema = z.enum(["Pending", "Success", "Failure", "Canceled"]);
const paymentListSchema = z.object({
  payments: z.array(
    z.object({
      id: z.string(),
      status: statusSchema,
      amount: money,
      method: z.string().optional(),
      type: z.string().optional(),
      paymentDate: z.string().optional(),
      movedTo: ref,
    }),
  ),
  count: z.number(),
});
const refundListSchema = z.object({
  refunds: z.array(
    z.object({
      id: z.string(),
      status: statusSchema,
      amount: money,
      refundDate: z.string().optional(),
      movedTo: ref,
    }),
  ),
  count: z.number(),
});

const RESERVATION_ID_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,39}$/;
/** Apaleo maximum page size of the folio list; payments/refunds use the same limit. */
const PAGE_SIZE = 500;

const FOLIO_KINDS: Record<z.infer<typeof folioSchema>["type"], FolioKind> = {
  Guest: "guest",
  Booking: "booking",
  House: "house",
  External: "external",
};
const DEBITORS: Record<NonNullable<z.infer<typeof folioSchema>["debitor"]>["type"], DebitorKind> = {
  Booker: "booker",
  PrimaryGuest: "primary-guest",
  AdditionalGuest: "additional-guest",
  Company: "company",
  Property: "property",
};
const STATUSES: Record<z.infer<typeof statusSchema>, PaymentStatus> = {
  Pending: "pending",
  Success: "success",
  Failure: "failure",
  Canceled: "canceled",
};
const RESERVATION_STATUS = {
  Confirmed: "confirmed",
  InHouse: "in-house",
  CheckedOut: "checked-out",
  Canceled: "canceled",
  NoShow: "no-show",
} as const;

export class ApaleoPaymentProvider implements PaymentProvider {
  readonly name = "apaleo";
  readonly #client: ApaleoClient;

  constructor(client: ApaleoClient) {
    this.#client = client;
  }

  async getPaymentSummary(reservationId: string): Promise<PaymentSummary> {
    if (!RESERVATION_ID_PATTERN.test(reservationId)) {
      throw new PmsError("not-found", "Invalid reservation id", { provider: "apaleo" });
    }
    const reservation = await this.#client.get(
      `/booking/v1/reservations/${encodeURIComponent(reservationId)}`,
      reservationSchema,
      "getPaymentReservation",
    );
    const own = await this.#folios(
      `reservationIds=${encodeURIComponent(reservation.id)}&expand=charges`,
      "listReservationFolios",
    );
    const booking = await this.#folios(
      `bookingIds=${encodeURIComponent(reservation.bookingId)}&type=Booking`,
      "listBookingFolios",
    );
    const folios: PaymentFolio[] = [];
    for (const folio of [...own, ...booking.filter((b) => !own.some((o) => o.id === b.id))]) {
      // Payments and refunds only where the guest might owe or be owed money – not on
      // company / third-party folios (they are not shown and not counted).
      const needsTransactions =
        folio.type === "Guest" && !folio.company && folio.debitor?.type !== "Company";
      folios.push(
        mapFolio(
          folio,
          needsTransactions ? await this.#payments(folio.id) : [],
          needsTransactions ? await this.#refunds(folio.id) : [],
        ),
      );
    }
    return {
      reservation: {
        status: RESERVATION_STATUS[reservation.status],
        arrivalAt: reservation.arrival,
        departureAt: reservation.departure,
        ...(reservation.cancellationFee?.dueDateTime
          ? { freeCancellationUntil: reservation.cancellationFee.dueDateTime }
          : {}),
        ...(reservation.ratePlan ? { ratePlanId: reservation.ratePlan.id } : {}),
        ...(reservation.guaranteeType ? { guaranteeType: reservation.guaranteeType } : {}),
        ...(reservation.channelCode ? { channelCode: reservation.channelCode } : {}),
        ...(reservation.paymentAccount?.isVirtual ? { virtualCard: true } : {}),
        ...(reservation.company ? { hasCompany: true } : {}),
        ...(reservation.payableAmount?.guest
          ? { payableByGuest: reservation.payableAmount.guest }
          : {}),
      },
      folios,
    };
  }

  async #folios(query: string, operation: string) {
    const list = await this.#client.getList(
      `/finance/v1/folios?${query}&pageSize=${PAGE_SIZE}`,
      folioListSchema,
      operation,
    );
    if (!list) return [];
    complete(list.folios.length, list.count, operation);
    return list.folios;
  }

  async #payments(folioId: string): Promise<FolioPayment[]> {
    const list = await this.#client.getList(
      `/finance/v1/folios/${encodeURIComponent(folioId)}/payments?pageSize=${PAGE_SIZE}`,
      paymentListSchema,
      "listFolioPayments",
    );
    if (!list) return [];
    complete(list.payments.length, list.count, "listFolioPayments");
    return list.payments.map((payment) => ({
      id: payment.id,
      status: STATUSES[payment.status],
      amount: payment.amount,
      ...(payment.method ? { method: payment.method } : {}),
      ...(payment.type ? { type: payment.type } : {}),
      ...(payment.paymentDate ? { at: payment.paymentDate } : {}),
      elsewhere: payment.movedTo !== undefined,
    }));
  }

  async #refunds(folioId: string): Promise<FolioRefund[]> {
    const list = await this.#client.getList(
      `/finance/v1/folios/${encodeURIComponent(folioId)}/refunds?pageSize=${PAGE_SIZE}`,
      refundListSchema,
      "listFolioRefunds",
    );
    if (!list) return [];
    complete(list.refunds.length, list.count, "listFolioRefunds");
    return list.refunds.map((refund) => ({
      id: refund.id,
      status: STATUSES[refund.status],
      amount: refund.amount,
      ...(refund.refundDate ? { at: refund.refundDate } : {}),
      elsewhere: refund.movedTo !== undefined,
    }));
  }
}

/** A partial list would undercount payments – treat it as unusable rather than guess. */
function complete(received: number, count: number, operation: string): void {
  if (received < count) {
    throw new PmsError("invalid-response", `${operation}: more items than one page`, {
      provider: "apaleo",
    });
  }
}

function mapFolio(
  folio: z.infer<typeof folioSchema>,
  payments: FolioPayment[],
  refunds: FolioRefund[],
): PaymentFolio {
  return {
    id: folio.id,
    kind: FOLIO_KINDS[folio.type],
    ...(folio.debitor ? { debitor: DEBITORS[folio.debitor.type] } : {}),
    hasCompany: folio.company !== undefined,
    isMain: folio.isMainFolio ?? false,
    isEmpty: folio.isEmpty ?? false,
    closed: folio.status !== "Open",
    balance: folio.balance,
    charges: (folio.charges ?? []).map((charge): FolioCharge => ({
      id: charge.id,
      name: { de: charge.translatedNames?.de ?? charge.name, ...pickEnglish(charge) },
      ...(charge.serviceType ? { serviceType: charge.serviceType } : {}),
      ...(charge.serviceDate ? { serviceDate: charge.serviceDate } : {}),
      gross: { amount: charge.amount.grossAmount, currency: charge.amount.currency },
      ...(charge.quantity !== undefined ? { quantity: charge.quantity } : {}),
      posted: charge.isPosted,
      elsewhere: charge.movedTo !== undefined || charge.routedTo !== undefined,
    })),
    payments,
    refunds,
  };
}

function pickEnglish(charge: z.infer<typeof chargeSchema>): { en?: string } {
  const en = charge.translatedNames?.en;
  return en ? { en } : {};
}

export function createApaleoPaymentProvider(
  options: { clientId: string; clientSecret: string; logger: Logger } & Partial<
    Omit<ApaleoClientOptions, "clientId" | "clientSecret" | "logger">
  >,
): ApaleoPaymentProvider {
  return new ApaleoPaymentProvider(new ApaleoClient(options));
}
