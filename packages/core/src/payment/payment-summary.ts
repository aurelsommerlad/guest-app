import { type LocalizedText } from "../i18n/localized-text";

/**
 * Provider-neutral payment data of ONE reservation (Phase 12, ADR 0018) – what a payment
 * provider (Apaleo) delivers, normalised. Amounts are gross, in major units, per currency.
 * Read-only: nothing here can create or change a payment.
 */
export type Money = { amount: number; currency: string };

export type PaymentReservationFacts = {
  /** PMS reservation status (canceled/no-show reservations owe nothing through the app). */
  status: "confirmed" | "in-house" | "checked-out" | "canceled" | "no-show";
  arrivalAt: string;
  departureAt: string;
  /** End of free cancellation (Apaleo `cancellationFee.dueDateTime`); undefined: none. */
  freeCancellationUntil?: string;
  /** Rate plan id – later per-rate payment rules. */
  ratePlanId?: string;
  /** Apaleo `guaranteeType` (PM6Hold, CreditCard, Prepayment, Company, Ota). */
  guaranteeType?: string;
  /** Booking channel (Direct, Ibe, BookingCom, Expedia, …). */
  channelCode?: string;
  /** The reservation's payment account is an OTA virtual card. */
  virtualCard?: boolean;
  /** A company is attached to the reservation. */
  hasCompany?: boolean;
  /** Apaleo `payableAmount.guest` (undocumented) – plausibility check only. */
  payableByGuest?: Money;
};

export type FolioKind = "guest" | "booking" | "house" | "external";
export type DebitorKind = "booker" | "primary-guest" | "additional-guest" | "company" | "property";

export type FolioCharge = {
  id: string;
  name: LocalizedText;
  serviceType?: string;
  /** YYYY-MM-DD */
  serviceDate?: string;
  gross: Money;
  quantity?: number;
  posted: boolean;
  /** Moved or routed to another folio – not owed on this one. */
  elsewhere: boolean;
};

export type PaymentStatus = "pending" | "success" | "failure" | "canceled";

export type FolioPayment = {
  id: string;
  status: PaymentStatus;
  amount: Money;
  /** Coarse method for display ("Visa", "Bank transfer" …) – never card data. */
  method?: string;
  /** Payment link, terminal, stored account … */
  type?: string;
  at?: string;
  /** Moved to another folio – not counted on this one. */
  elsewhere: boolean;
};

export type FolioRefund = {
  id: string;
  status: PaymentStatus;
  amount: Money;
  at?: string;
  elsewhere: boolean;
};

export type PaymentFolio = {
  id: string;
  kind: FolioKind;
  debitor?: DebitorKind;
  /** A company is set on the folio (third-party payer). */
  hasCompany: boolean;
  isMain: boolean;
  isEmpty: boolean;
  closed: boolean;
  /** Folio balance: negative = owed by the debitor (observed on Apaleo), positive = credit. */
  balance: Money;
  charges: readonly FolioCharge[];
  payments: readonly FolioPayment[];
  refunds: readonly FolioRefund[];
};

export type PaymentSummary = {
  reservation: PaymentReservationFacts;
  /** Folios of the reservation plus the booking's own folio(s). */
  folios: readonly PaymentFolio[];
};
