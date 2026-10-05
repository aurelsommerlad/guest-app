import "server-only";

import { connection } from "next/server";

import { serverEnv } from "../../env/server";
import { redirect } from "../../i18n/navigation";
import { type Locale } from "../../i18n/routing";
import { stayCardsForProperty } from "../../mocks/content/stay-cards";
import { MOCK_NOW, MOCK_RESERVATION_ID } from "../../mocks/stay/mock-stay";
import { logger } from "../../server/logger";
import { getApaleoProvider, getMockPms, pmsFor } from "../../server/pms";
import { getCurrentGuestAccess } from "../guest-access/server";
import { buildStayViewModel } from "./build-stay-view-model";
import { type StayViewModel } from "./model";
import { resolveStayDataSource } from "./stay-data-source";
import { loadSessionStay, logStayFailure, StayUnavailableError } from "./session-stay";
import { toStaySource } from "./to-stay-source";

const sourceOptions = {
  allowTestProperties: serverEnv.APP_ENV !== "production",
  cardsFor: stayCardsForProperty,
};

/** Preview stay (no session): mock data or the configured Apaleo preview reservation. */
async function getPreviewStay(locale: Locale): Promise<StayViewModel> {
  const config = resolveStayDataSource(serverEnv, MOCK_RESERVATION_ID);
  if (config.kind === "apaleo") {
    // Live data: render per request, never at build time.
    await connection();
  }
  try {
    const pms = config.kind === "mock" ? getMockPms() : getApaleoProvider();
    if (!pms) throw new Error("Preview data source is not available");
    const reservation = await pms.getReservation(config.reservationId);
    const source = toStaySource(reservation, sourceOptions);
    return buildStayViewModel(source, locale, config.kind === "mock" ? MOCK_NOW : new Date());
  } catch (error) {
    logStayFailure(logger, { dataSource: config.kind }, error);
    throw new StayUnavailableError();
  }
}

/**
 * Loads the current guest's stay. With a valid guest session: that reservation.
 * Without one: `secured` mode sends the guest to the login, `preview` mode shows the
 * preview stay (development workflow). The UI never knows which source was used.
 */
export async function getStay(locale: Locale): Promise<StayViewModel> {
  const access = await getCurrentGuestAccess();
  if (access) {
    await connection();
    const stay = await loadSessionStay(access, {
      pms: pmsFor(access.reservationProvider),
      locale,
      now: new Date(),
      sourceOptions,
      logger,
    });
    if (stay.kind === "access-invalid") return redirect({ href: "/link-invalid", locale });
    return stay.viewModel;
  }
  if (serverEnv.GUEST_ACCESS_MODE === "secured") {
    await connection();
    return redirect({ href: "/login", locale });
  }
  return getPreviewStay(locale);
}
