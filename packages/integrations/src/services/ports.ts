/**
 * Ports of the STAY service booking engine (M3). The engine is the Extras business logic
 * (aurelsommerlad/guest-services lib/guest.js, lib/requests.js) re-wired to STAY: Apaleo is read
 * through ApaleoServiceReader, every write goes through the ServiceWriteGateway, configuration
 * and records come from @up/db (implemented there, structurally typed here).
 */
import {
  type BookingRule,
  type ServiceActionType,
  type ServiceFulfillmentMode,
  type StayExtensionSettings,
} from "@up/core";

export type Bilingual = { de: string; en: string };

/** One catalog entry for a property: offer texts + the M2 property configuration. */
export type EngineCatalogItem = {
  offerId: string;
  /** Apaleo service id of this property (offer_properties.extras_service_id). */
  serviceId: string;
  title: Bilingual;
  description: Bilingual;
  category: string;
  imageUrl: string | null;
  actionType: ServiceActionType;
  bookingRule: BookingRule;
  fulfillment: ServiceFulfillmentMode;
  /** Additional guest: surcharge per person and night in currency units (cents / 100). */
  extraPersonPricePerNight: number | null;
  currency: string | null;
  priceUnitLabel: { de?: string; en?: string } | null;
  /** Imported Extras text fields; while set, guests see Extras' text logic (parity). */
  extrasTexts?: Record<string, string> | null;
  requiresRemainingCapacity: boolean;
  requiresVehicleRegistration: boolean;
  maxOnePerReservation: boolean;
  allowedUnitGroupIds: readonly string[];
  sortOrder: number | null;
  /** "Im Gäste-Portal anzeigen" (Extras `active`). */
  active: boolean;
  /** Offer published in STAY (editorial release; Extras has no equivalent). */
  published: boolean;
};

export type EngineContext = {
  tenantId: string;
  /** STAY property id. */
  propertyId: string;
  /** The Apaleo property it is mapped to. */
  apaleoPropertyId: string;
};

export type StoredBookingItem = {
  serviceId: string;
  displayName: string;
  quantity: number;
  status: "pending" | "booked" | "failed" | "skipped";
  errorCode: string | null;
  amountCents: number | null;
};

export type BeginBookingResult =
  | { kind: "new"; id: string }
  /** A processing booking whose lease ran out (aborted request) – safe to resume. */
  | { kind: "resume"; id: string }
  | { kind: "in-progress"; id: string }
  | {
      kind: "done";
      id: string;
      status: "completed" | "partial" | "failed";
      items: StoredBookingItem[];
    };

export type StoredRequest = {
  id: string;
  propertyId: string;
  externalReservationId: string;
  offerId: string;
  apaleoServiceId: string | null;
  quantity: number | null;
  requestedDates: string[] | null;
  status: string;
  source: "stay" | "extras";
  serviceName: string;
  /** Price shown to the guest for one count (cents). */
  quotedCents: number | null;
  currency: string | null;
};

export type ServiceRecordStore = {
  loadCatalog(context: { tenantId: string; propertyId: string }): Promise<EngineCatalogItem[]>;
  getExtensionSettings(context: {
    tenantId: string;
    propertyId: string;
  }): Promise<StayExtensionSettings>;
  beginBooking(input: {
    tenantId: string;
    propertyId: string;
    externalReservationId: string;
    idempotencyKey: string;
    now: Date;
    leaseMs: number;
  }): Promise<BeginBookingResult>;
  saveBookingItem(input: {
    tenantId: string;
    bookingId: string;
    offerId: string | null;
    serviceId: string;
    displayName: string;
    actionType: ServiceActionType;
    quantity: number;
    serviceDates: readonly string[];
    amountCents: number | null;
    currency: string | null;
    status: StoredBookingItem["status"];
    errorCode: string | null;
  }): Promise<void>;
  finishBooking(input: {
    tenantId: string;
    bookingId: string;
    status: "completed" | "partial" | "failed";
    totalCents: number | null;
    currency: string | null;
    now: Date;
  }): Promise<void>;
  createRequest(input: {
    tenantId: string;
    propertyId: string;
    externalReservationId: string;
    offerId: string;
    apaleoServiceId: string;
    quantity: number;
    requestedDates: readonly string[];
    quotedCents: number | null;
    currency: string | null;
    idempotencyKey: string | null;
    now: Date;
  }): Promise<{ id: string; replayed: boolean }>;
  findRequestByKey(
    context: { tenantId: string },
    idempotencyKey: string,
  ): Promise<{ id: string; externalReservationId: string; apaleoServiceId: string | null } | null>;
  /** A pending or confirmed STAY request for this service on the reservation. */
  hasOpenRequest(
    context: { tenantId: string },
    externalReservationId: string,
    apaleoServiceId: string,
  ): Promise<boolean>;
  getRequest(context: { tenantId: string }, requestId: string): Promise<StoredRequest | null>;
  completeRequest(input: {
    tenantId: string;
    requestId: string;
    decision: "confirm" | "decline";
    bookedServiceDates?: readonly string[];
    decisionReason?: string | null;
    actorAdminId: string | null;
    now: Date;
  }): Promise<
    { ok: true } | { ok: false; reason: "not-found" | "not-pending" | "handled-in-extras" }
  >;
  addStayExtension(input: {
    tenantId: string;
    propertyId: string;
    externalReservationId: string;
    oldDeparture: string;
    newDeparture: string;
    newDepartureConfirmed: boolean;
    phase: "pre_arrival" | "in_house";
    gap: number;
    averageNightlyRateCents: number | null;
    discountPercent: number;
    extensionPriceCents: number | null;
    totalAdditionalCents: number | null;
    currency: string;
    details: Record<string, unknown>;
    mandatoryServicesIntact: boolean;
    status: "confirmed" | "confirmed_with_issues" | "failed";
    now: Date;
  }): Promise<{ id: string }>;
  /** Queues a staff notification in the outbox (never sent by the engine itself). */
  notify(input: {
    tenantId: string;
    propertyId: string;
    template: string;
    dedupKey: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
};

/** Short-lived exclusive claims (Extras: setIfNotExists claims). */
export type ServiceLockStore = {
  claim(input: {
    tenantId: string;
    key: string;
    holder: string;
    ttlMs: number;
    now: Date;
  }): Promise<boolean>;
  release(input: { tenantId: string; key: string; holder: string }): Promise<void>;
};
