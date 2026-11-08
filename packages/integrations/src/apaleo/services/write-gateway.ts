/**
 * STAY's central Apaleo write interface for services (Extras migration M1-C).
 *
 * In M1 nothing is ever sent to Apaleo: the gateway knows two modes only –
 *   disabled  (default) every command is recorded as `blocked/writes_disabled`;
 *   simulated  commands pass all checks and end as `simulated` (for staging tests).
 * A live executor does not exist in this code base; adding one needs the go-live approval.
 *
 * Every command, in this order:
 *   1. canonical request hash, reservation under its idempotency key (duplicate → stored
 *      result, same key with another payload → rejected, parallel → in progress);
 *   2. policy: mode, production writer (`stay` only after the joint go-live), property
 *      allowlist, the reservation must belong to the property and be bookable;
 *   3. execution (simulated), mapped result code, completion and audit.
 */
import { createHash } from "node:crypto";

import { PmsError } from "@up/core";

export const SERVICE_WRITE_MODES = ["disabled", "simulated"] as const;
export type ServiceWriteMode = (typeof SERVICE_WRITE_MODES)[number];

/** Reads the mode from the environment value; anything unknown – including "live" – is disabled. */
export function parseServiceWriteMode(value: string | undefined): ServiceWriteMode {
  return value === "simulated" ? "simulated" : "disabled";
}

/** AmendReservation body as built by the core rules (buildOccupancy/StayExtensionAmendmentPayload). */
export type AmendReservationPayload = {
  arrival: unknown;
  departure: unknown;
  adults: number;
  childrenAges: readonly number[] | null;
  timeSlices: readonly {
    ratePlanId: string;
    totalGrossAmount: { amount: number; currency: string };
  }[];
  requote: boolean;
};

/**
 * One Apaleo write, carrying exactly the body Extras sends (lib/apaleo.js): book-service replaces
 * the whole date set of a service, so `dates` is always the complete desired set.
 */
export type ServiceWriteCommand =
  | {
      operation: "book-service";
      serviceId: string;
      /** Top-level count (Extras: the line count, or the highest per-date count). */
      count?: number;
      dates: readonly {
        serviceDate: string;
        count?: number;
        amount?: { amount: number; currency: string };
      }[];
    }
  | { operation: "amend-occupancy"; payload: AmendReservationPayload }
  | { operation: "amend-stay"; payload: AmendReservationPayload }
  | { operation: "move-service"; serviceId: string; fromDate: string; toDate: string }
  | { operation: "update-vehicle"; number: string; countryCode: string }
  /** Appended to the reservation's internal comment (never overwritten). */
  | { operation: "append-comment"; text: string };

export type ServiceWriteRequest = {
  tenantId: string;
  /** STAY property id (row in `properties`). */
  propertyId: string;
  /** The Apaleo property the STAY property is mapped to. */
  apaleoPropertyId: string;
  reservationId: string;
  idempotencyKey: string;
  trigger: "guest" | "admin" | "system";
  actorAdminId?: string | null;
  command: ServiceWriteCommand;
};

export type ServiceWriteOutcome =
  | { status: "simulated" | "succeeded"; code: string; replayed: boolean }
  | { status: "blocked" | "failed"; code: string; replayed: boolean }
  | { status: "rejected"; code: "idempotency_conflict" }
  | { status: "in_progress" };

/** Persistence the gateway needs – implemented by @up/db (reserveApaleoWrite & co.). */
export type ServiceWriteStore = {
  getServiceWriter(tenantId: string): Promise<"extras" | "stay">;
  reserve(input: {
    tenantId: string;
    propertyId: string;
    externalReservationId: string;
    operation: ServiceWriteCommand["operation"];
    idempotencyKey: string;
    requestHash: string;
    trigger: ServiceWriteRequest["trigger"];
    actorAdminId?: string | null;
    now: Date;
  }): Promise<
    | { kind: "acquired"; id: string; takeover: boolean }
    | { kind: "in-progress"; id: string }
    | {
        kind: "done";
        id: string;
        status: "blocked" | "simulated" | "succeeded" | "failed";
        resultCode: string | null;
      }
    | { kind: "conflict"; id: string }
  >;
  complete(input: {
    tenantId: string;
    id: string;
    status: "blocked" | "simulated" | "succeeded" | "failed";
    resultCode: string;
    httpStatus?: number | null;
    now: Date;
  }): Promise<void>;
};

export type ReservationLookup = (
  reservationId: string,
) => Promise<{ property: { id: string }; status: string }>;

/** Executes a command against Apaleo. M1 ships the simulated executor only. */
export type ServiceWriteExecutor = (
  request: ServiceWriteRequest,
) => Promise<{ code: string; httpStatus?: number }>;

export const simulatedExecutor: ServiceWriteExecutor = () => Promise.resolve({ code: "simulated" });

export type ServiceWriteGatewayOptions = {
  mode: ServiceWriteMode;
  /** Apaleo property ids writes may target (e.g. ["TEST"] on staging). Empty = none. */
  allowedApaleoPropertyIds: readonly string[];
  store: ServiceWriteStore;
  lookupReservation: ReservationLookup;
  executor?: ServiceWriteExecutor;
  /**
   * Test/shadow harness only: told about every command that ended as `simulated`, so an
   * in-memory Apaleo double can apply it. Never wired in the apps; it cannot change the
   * outcome and is not called for blocked or failed commands.
   */
  onSimulated?: (request: ServiceWriteRequest) => void | Promise<void>;
  now?: () => Date;
};

const BOOKABLE_STATUSES = new Set(["Confirmed", "InHouse"]);
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_:.-]{8,200}$/;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, stable(v)]),
    );
  }
  return value;
}

/** SHA-256 over the canonical request (key order independent). */
export function serviceWriteRequestHash(request: ServiceWriteRequest): string {
  const canonical = JSON.stringify(
    stable({
      tenantId: request.tenantId,
      propertyId: request.propertyId,
      reservationId: request.reservationId,
      command: request.command,
    }),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

function errorCode(error: unknown): string {
  if (error instanceof PmsError) {
    return {
      auth: "apaleo_auth",
      "not-found": "reservation_not_found",
      timeout: "apaleo_timeout",
      unavailable: "apaleo_unavailable",
      "invalid-response": "apaleo_invalid_response",
    }[error.kind];
  }
  return "unexpected_error";
}

export class ServiceWriteGateway {
  readonly #options: ServiceWriteGatewayOptions;
  readonly #executor: ServiceWriteExecutor;
  readonly #now: () => Date;

  constructor(options: ServiceWriteGatewayOptions) {
    this.#options = options;
    this.#executor = options.executor ?? simulatedExecutor;
    this.#now = options.now ?? (() => new Date());
  }

  get mode(): ServiceWriteMode {
    return this.#options.mode;
  }

  async execute(request: ServiceWriteRequest): Promise<ServiceWriteOutcome> {
    if (!IDEMPOTENCY_KEY.test(request.idempotencyKey))
      throw new TypeError("Invalid idempotency key");
    const { store } = this.#options;
    const now = this.#now();
    const reservation = await store.reserve({
      tenantId: request.tenantId,
      propertyId: request.propertyId,
      externalReservationId: request.reservationId,
      operation: request.command.operation,
      idempotencyKey: request.idempotencyKey,
      requestHash: serviceWriteRequestHash(request),
      trigger: request.trigger,
      actorAdminId: request.actorAdminId ?? null,
      now,
    });
    if (reservation.kind === "conflict")
      return { status: "rejected", code: "idempotency_conflict" };
    if (reservation.kind === "in-progress") return { status: "in_progress" };
    if (reservation.kind === "done") {
      return {
        status: reservation.status,
        code: reservation.resultCode ?? "unknown",
        replayed: true,
      };
    }

    const finish = async (
      status: "blocked" | "simulated" | "succeeded" | "failed",
      code: string,
      httpStatus?: number,
    ): Promise<ServiceWriteOutcome> => {
      await store.complete({
        tenantId: request.tenantId,
        id: reservation.id,
        status,
        resultCode: code,
        httpStatus: httpStatus ?? null,
        now: this.#now(),
      });
      return { status, code, replayed: false };
    };

    const blocked = await this.#policy(request);
    if (blocked) return finish("blocked", blocked);

    try {
      const result = await this.#executor(request);
      if (this.mode === "simulated" && this.#options.onSimulated)
        await this.#options.onSimulated(request);
      return await finish(
        this.mode === "simulated" ? "simulated" : "succeeded",
        result.code,
        result.httpStatus,
      );
    } catch (error) {
      return finish(
        "failed",
        errorCode(error),
        error instanceof PmsError ? error.status : undefined,
      );
    }
  }

  /** The first reason a command must not be executed, or null. */
  async #policy(request: ServiceWriteRequest): Promise<string | null> {
    const { mode, allowedApaleoPropertyIds, store, lookupReservation } = this.#options;
    if (mode === "disabled") return "writes_disabled";
    // Simulated commands never reach Apaleo, so they may run while Extras is the production
    // writer (staging tests). Any executor that really writes must pass this check.
    const writer = await store.getServiceWriter(request.tenantId);
    if (writer !== "stay" && this.#executor !== simulatedExecutor) return "writer_is_extras";
    if (!allowedApaleoPropertyIds.includes(request.apaleoPropertyId)) return "property_not_allowed";
    let reservation: Awaited<ReturnType<ReservationLookup>>;
    try {
      reservation = await lookupReservation(request.reservationId);
    } catch (error) {
      return errorCode(error);
    }
    if (reservation.property.id !== request.apaleoPropertyId)
      return "reservation_property_mismatch";
    if (!BOOKABLE_STATUSES.has(reservation.status)) return "reservation_not_bookable";
    return null;
  }
}
