/**
 * Client of the internal STAY bridge of the Extras app (upselling Phase 2, framework-free).
 *
 * - Server-to-server only: the browser never sees the bridge, its URL, the secret or a token.
 * - One short-lived token per call (HS256, ≤ 60 s, unique id), bound to tenant, Apaleo
 *   property and Apaleo reservation of the current guest context – never to anything the
 *   browser sends. No last name and no reservation number ever appear in a URL.
 * - Extras stays the only backend for prices, availability, Apaleo bookings and approvals;
 *   STAY only renders what the bridge answers and sends the guest's choice.
 */
import { createHmac, randomUUID } from "node:crypto";

import { z } from "zod";

export const TOKEN_LIFETIME_SECONDS = 60;
const TIMEOUT_MS = 10_000;

export type BridgeSubject = {
  tenantId: string;
  /** Apaleo property id (e.g. "TEST"). */
  apaleoPropertyId: string;
  /** Apaleo reservation id (e.g. "JTKQSYFX-1"). */
  reservationId: string;
};

const bilingual = z.object({ de: z.string(), en: z.string() });
const money = z.object({ amountCents: z.number().int(), currency: z.string().length(3) });

export const extrasItemSchema = z.object({
  serviceId: z.string().min(1).max(120),
  code: z.string().nullable(),
  name: bilingual,
  description: bilingual,
  imageUrl: z.string().nullable(),
  actionType: z.enum(["service", "increase_occupancy"]),
  bookingRule: z.string(),
  fulfillment: z.enum(["instant", "request"]),
  priceUnitLabel: bilingual.nullable().catch(null),
  unitPrice: money.nullable(),
  nights: z.number().int().min(1).nullable().catch(1),
  price: money.nullable(),
  serviceDates: z.array(z.string()),
  restricted: z.boolean(),
  maxQuantity: z.number().int().min(0).nullable(),
  maxOnePerReservation: z.boolean(),
  bookedCount: z.number().int().min(0),
  requiresVehicleRegistration: z.boolean(),
  existingVehicleRegistration: z.string().nullable(),
});
export type ExtrasItem = z.infer<typeof extrasItemSchema>;

export const extrasExtensionSchema = z.object({
  currentDeparture: z.string(),
  newDeparture: z.string(),
  phase: z.string().nullable(),
  discountPercent: z.number().nullable(),
  extensionPrice: money.nullable(),
  extras: z.array(
    z.object({ serviceId: z.string(), name: bilingual, amountCents: z.number().int().nullable() }),
  ),
  cityTaxCents: z.number().int().nullable(),
  totalPrice: money.nullable(),
});
export type ExtrasExtension = z.infer<typeof extrasExtensionSchema>;

const catalogSchema = z.object({
  pastStay: z.boolean(),
  arrival: z.string().optional(),
  departure: z.string().optional(),
  items: z.array(extrasItemSchema),
  extension: extrasExtensionSchema.nullable(),
});
export type ExtrasCatalog = z.infer<typeof catalogSchema>;

export const EXTRAS_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;

const overviewSchema = z.object({
  booked: z.array(
    z.object({
      serviceId: z.string(),
      name: bilingual,
      count: z.number().int(),
      dates: z.array(z.string()),
      total: money.nullable(),
    }),
  ),
  amendments: z
    .array(
      z.object({
        serviceId: z.string(),
        name: bilingual,
        count: z.number().int(),
        total: money.nullable(),
        createdAt: z.string(),
      }),
    )
    .default([]),
  requests: z.array(
    z.object({
      requestId: z.string(),
      serviceId: z.string(),
      serviceName: z.string().nullable().catch(null),
      quantity: z.number().int().nullable().catch(null),
      status: z.enum(EXTRAS_REQUEST_STATUSES),
      createdAt: z.string(),
      decidedAt: z.string().nullable(),
    }),
  ),
  extensions: z.array(
    z.object({ newDeparture: z.string(), status: z.string().nullable().catch(null) }),
  ),
});
export type ExtrasOverview = z.infer<typeof overviewSchema>;

const orderResultSchema = z.object({
  status: z.literal("booked"),
  serviceId: z.string(),
  count: z.number().int(),
  serviceDates: z.array(z.string()),
  price: money.nullable(),
});
const requestResultSchema = z.object({
  status: z.literal("pending"),
  requestId: z.string(),
  serviceId: z.string(),
});
const extensionResultSchema = z.object({
  status: z.literal("booked"),
  newDeparture: z.string(),
  price: money.nullable(),
});

/** Refusals the bridge can answer with (anything else counts as unavailable). */
export const EXTRAS_REFUSALS = [
  "price_changed",
  "already_booked",
  "already_requested",
  "not_available",
  "limit_reached",
  "capacity_exceeded",
  "vehicle_registration_required",
  "in_progress",
  "rate_limited",
] as const;
export type ExtrasRefusal = (typeof EXTRAS_REFUSALS)[number];

export type BridgeResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "refused"; reason: ExtrasRefusal; price?: { amountCents: number; currency: string } }
  /** Not reachable, not configured for this property, unexpected answer – never a guess. */
  | { kind: "unavailable" };

export type OrderInput = {
  idempotencyKey: string;
  serviceId: string;
  count: number;
  vehiclePlates?: string[];
  expectedPrice: { amountCents: number; currency: string };
};
export type RequestInput = { idempotencyKey: string; serviceId: string; quantity: number };
export type ExtensionInput = {
  idempotencyKey: string;
  currentDeparture: string;
  expectedPrice: { amountCents: number; currency: string };
};

export interface ExtrasBridge {
  catalog(subject: BridgeSubject): Promise<BridgeResult<ExtrasCatalog>>;
  overview(subject: BridgeSubject): Promise<BridgeResult<ExtrasOverview>>;
  order(
    subject: BridgeSubject,
    input: OrderInput,
  ): Promise<BridgeResult<z.infer<typeof orderResultSchema>>>;
  request(
    subject: BridgeSubject,
    input: RequestInput,
  ): Promise<BridgeResult<z.infer<typeof requestResultSchema>>>;
  extend(
    subject: BridgeSubject,
    input: ExtensionInput,
  ): Promise<BridgeResult<z.infer<typeof extensionResultSchema>>>;
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

/** HS256 JWT as the bridge expects it (exported for tests). */
export function signBridgeToken(
  subject: BridgeSubject,
  scope: "read" | "write",
  secret: string,
  now: Date,
  jti: string = randomUUID(),
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: "stay",
      aud: "extras-stay-bridge",
      sub: subject.reservationId,
      tid: subject.tenantId,
      pid: subject.apaleoPropertyId,
      scope,
      jti,
      iat,
      exp: iat + TOKEN_LIFETIME_SECONDS,
    }),
  );
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

const refusalSchema = z.object({
  error: z.enum(EXTRAS_REFUSALS),
  price: money.nullable().optional(),
});

export function createExtrasBridge(options: {
  baseUrl: string;
  secret: string;
  /** Vercel deployment protection bypass (preview deployments only). */
  protectionBypass?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  onError?: (route: string, detail: { status?: number; error?: string }) => void;
}): ExtrasBridge {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const base = options.baseUrl.replace(/\/+$/, "");

  async function call<T>(
    route: string,
    scope: "read" | "write",
    subject: BridgeSubject,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<BridgeResult<T>> {
    let response: Response;
    try {
      response = await doFetch(`${base}/api/stay/v1/${route}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${signBridgeToken(subject, scope, options.secret, now())}`,
          ...(options.protectionBypass
            ? { "x-vercel-protection-bypass": options.protectionBypass }
            : {}),
        },
        body: JSON.stringify(body ?? {}),
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      options.onError?.(route, { error: error instanceof Error ? error.name : "fetch" });
      return { kind: "unavailable" };
    }
    const json: unknown = await response.json().catch(() => null);
    if (response.ok) {
      const parsed = schema.safeParse(json);
      if (parsed.success) return { kind: "ok", value: parsed.data };
      options.onError?.(route, { status: response.status, error: "unexpected_shape" });
      return { kind: "unavailable" };
    }
    const refusal = refusalSchema.safeParse(json);
    if (refusal.success && response.status < 500) {
      return {
        kind: "refused",
        reason: refusal.data.error,
        ...(refusal.data.price ? { price: refusal.data.price } : {}),
      };
    }
    options.onError?.(route, { status: response.status });
    return { kind: "unavailable" };
  }

  return {
    catalog: (subject) => call("catalog", "read", subject, {}, catalogSchema),
    overview: (subject) => call("overview", "read", subject, {}, overviewSchema),
    order: (subject, input) => call("order", "write", subject, input, orderResultSchema),
    request: (subject, input) => call("request", "write", subject, input, requestResultSchema),
    extend: (subject, input) =>
      call("stay-extension", "write", subject, input, extensionResultSchema),
  };
}
