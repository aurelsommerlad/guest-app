import "server-only";

import { type PaymentProvider, type PmsProvider, type ReservationProvider } from "@up/core";
import { createApaleoPaymentProvider, createApaleoProvider } from "@up/integrations";

import { serverEnv } from "../env/server";
import { createMockPms } from "../mocks/stay/mock-pms";
import { logger } from "./logger";

let apaleoProvider: PmsProvider | undefined;
let apaleoPayments: PaymentProvider | undefined;

/** Shared Apaleo provider (one per server process, so the access token is reused). */
export function getApaleoProvider(): PmsProvider | undefined {
  if (!serverEnv.APALEO_CLIENT_ID || !serverEnv.APALEO_CLIENT_SECRET) return undefined;
  apaleoProvider ??= createApaleoProvider({
    clientId: serverEnv.APALEO_CLIENT_ID,
    clientSecret: serverEnv.APALEO_CLIENT_SECRET,
    logger,
  });
  return apaleoProvider;
}

/** Read-only Apaleo payment data (Phase 12 A, scope folios.read) – one per server process. */
export function getApaleoPaymentProvider(): PaymentProvider | undefined {
  if (!serverEnv.APALEO_CLIENT_ID || !serverEnv.APALEO_CLIENT_SECRET) return undefined;
  apaleoPayments ??= createApaleoPaymentProvider({
    clientId: serverEnv.APALEO_CLIENT_ID,
    clientSecret: serverEnv.APALEO_CLIENT_SECRET,
    logger,
  });
  return apaleoPayments;
}

/** The mock PMS never runs in production. */
export function getMockPms(): PmsProvider | undefined {
  return serverEnv.APP_ENV === "production" ? undefined : createMockPms(new Date());
}

/** PMS for a stored reservation provider; undefined if it is not available here. */
export function pmsFor(provider: ReservationProvider): PmsProvider | undefined {
  return provider === "apaleo" ? getApaleoProvider() : getMockPms();
}

/**
 * PMS used for the booking number login: Apaleo when configured; otherwise the mock
 * PMS outside production (local development); otherwise none (login fails closed).
 */
export function loginPms(): { provider: ReservationProvider; pms: PmsProvider } | undefined {
  const apaleo = getApaleoProvider();
  if (apaleo) return { provider: "apaleo", pms: apaleo };
  const mock = getMockPms();
  return mock ? { provider: "mock", pms: mock } : undefined;
}
