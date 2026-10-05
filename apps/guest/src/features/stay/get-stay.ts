import "server-only";

import { type PmsProvider } from "@up/core";
import { createApaleoProvider, MockPmsProvider } from "@up/integrations";
import { connection } from "next/server";

import { serverEnv } from "../../env/server";
import { type Locale } from "../../i18n/routing";
import { stayCardsForProperty } from "../../mocks/content/stay-cards";
import { MOCK_NOW, MOCK_RESERVATION_ID, mockReservation } from "../../mocks/stay/mock-stay";
import { logger } from "../../server/logger";
import { buildStayViewModel } from "./build-stay-view-model";
import { type StayViewModel } from "./model";
import { resolveStayDataSource, type StayDataSourceConfig } from "./stay-data-source";
import { toStaySource } from "./to-stay-source";

/** Raised to the UI when the stay cannot be loaded. Carries no technical details. */
export class StayUnavailableError extends Error {
  constructor() {
    super("The stay is currently unavailable");
    this.name = "StayUnavailableError";
  }
}

let apaleoProvider: PmsProvider | undefined;

function providerFor(config: StayDataSourceConfig): PmsProvider {
  if (config.kind === "mock") {
    return new MockPmsProvider([mockReservation]);
  }
  // One instance per server process, so the access token is reused.
  apaleoProvider ??= createApaleoProvider({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    logger,
  });
  return apaleoProvider;
}

/**
 * Loads the current guest's stay:
 * data source (mock | apaleo) → PmsReservation → StaySource → view model.
 * The UI never knows which source was used.
 */
export async function getStay(locale: Locale): Promise<StayViewModel> {
  const config = resolveStayDataSource(serverEnv, MOCK_RESERVATION_ID);
  if (config.kind === "apaleo") {
    // Live data: render per request, never at build time.
    await connection();
  }

  try {
    const reservation = await providerFor(config).getReservation(config.reservationId);
    const source = toStaySource(reservation, {
      allowTestProperties: serverEnv.APP_ENV !== "production",
      cardsFor: stayCardsForProperty,
    });
    return buildStayViewModel(source, locale, config.kind === "mock" ? MOCK_NOW : new Date());
  } catch (error) {
    // Safe to log: PmsError and StayMappingError messages contain no secrets or guest data.
    logger.error("stay could not be loaded", {
      dataSource: config.kind,
      error: error instanceof Error ? { name: error.name, message: error.message } : "unknown",
      ...(error && typeof error === "object" && "kind" in error ? { kind: error.kind } : {}),
      ...(error && typeof error === "object" && "reason" in error ? { reason: error.reason } : {}),
    });
    throw new StayUnavailableError();
  }
}
