import "server-only";

import { type Locale } from "../../i18n/routing";
import { requireGuestContext } from "../guest-context/server";
import { getStayJourney } from "../journey/server";
import { guestRegistrationStatus } from "../journey/stay-journey";
import { buildStayViewModel } from "./build-stay-view-model";
import { type StayViewModel } from "./model";

/** Raised to the UI when the stay cannot be loaded. Carries no technical details. */
export class StayUnavailableError extends Error {
  constructor() {
    super("The stay is currently unavailable");
    this.name = "StayUnavailableError";
  }
}

/**
 * The current guest's stay, from the central guest context (session or development
 * preview). The UI never knows which source was used.
 */
export async function getStay(locale: Locale): Promise<StayViewModel> {
  const context = await requireGuestContext(locale);
  if (context.reservation.status !== "loaded") throw new StayUnavailableError();
  const journey = await getStayJourney(context);
  const guestRegistration = journey ? guestRegistrationStatus(journey) : undefined;
  return buildStayViewModel(
    context.reservation.source,
    locale,
    context.now,
    journey ? { ...journey, ...(guestRegistration ? { guestRegistration } : {}) } : undefined,
  );
}
