import "server-only";

import { cache } from "react";

import { serverEnv } from "../../env/server";
import { redirect } from "../../i18n/navigation";
import { type Locale } from "../../i18n/routing";
import { stayCardsForProperty } from "../../mocks/content/stay-cards";
import { MOCK_NOW, MOCK_RESERVATION_ID } from "../../mocks/stay/mock-stay";
import { logger } from "../../server/logger";
import { pmsFor } from "../../server/pms";
import { getCurrentGuestAccess } from "../guest-access/server";
import { resolveStayDataSource } from "../stay/stay-data-source";
import { type GuestContext, type GuestContextResult, resolveGuestContext } from "./guest-context";

/**
 * The current request's guest context – resolved once per request (React cache) and
 * shared by every section rendered in it.
 */
export const getGuestContext = cache(async (): Promise<GuestContextResult> => {
  const access = await getCurrentGuestAccess();
  return resolveGuestContext({
    access,
    allowPreview: serverEnv.GUEST_ACCESS_MODE === "preview" && serverEnv.APP_ENV !== "production",
    preview: () => {
      const config = resolveStayDataSource(serverEnv, MOCK_RESERVATION_ID);
      return {
        provider: config.kind,
        reservationId: config.reservationId,
        now: config.kind === "mock" ? MOCK_NOW : new Date(),
      };
    },
    pmsFor,
    now: new Date(),
    sourceOptions: {
      allowTestProperties: serverEnv.APP_ENV !== "production",
      cardsFor: stayCardsForProperty,
    },
    logger,
  });
});

/**
 * Context for a guest page: without a valid session the guest is sent to the login,
 * with an access that no longer fits its reservation to the neutral invalid-link page.
 */
export async function requireGuestContext(locale: Locale): Promise<GuestContext> {
  const result = await getGuestContext();
  if (result.kind === "unauthenticated") return redirect({ href: "/login", locale });
  if (result.kind === "access-invalid") return redirect({ href: "/link-invalid", locale });
  return result.context;
}
