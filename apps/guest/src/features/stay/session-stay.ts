import { type Logger, type PmsProvider, type PmsReservation } from "@up/core";

import { type Locale } from "../../i18n/routing";
import { type CurrentGuestAccess } from "../guest-access/guest-access-service";
import { buildStayViewModel } from "./build-stay-view-model";
import { type StayViewModel } from "./model";
import { StayMappingError, type StaySourceOptions, toStaySource } from "./to-stay-source";

/** Raised to the UI when the stay cannot be loaded. Carries no technical details. */
export class StayUnavailableError extends Error {
  constructor() {
    super("The stay is currently unavailable");
    this.name = "StayUnavailableError";
  }
}

/** Safe to log: PmsError and StayMappingError messages contain no secrets or guest data. */
export function logStayFailure(
  logger: Logger,
  fields: Record<string, unknown>,
  error: unknown,
): void {
  logger.error("stay could not be loaded", {
    ...fields,
    error: error instanceof Error ? { name: error.name, message: error.message } : "unknown",
    ...(error && typeof error === "object" && "kind" in error ? { kind: error.kind } : {}),
    ...(error && typeof error === "object" && "reason" in error ? { reason: error.reason } : {}),
  });
}

export type SessionStay =
  | { kind: "stay"; viewModel: StayViewModel }
  /** The reservation no longer fits the access (canceled, moved, other tenant). */
  | { kind: "access-invalid" };

/**
 * Current stay from the guest session:
 * guest access → external reservation id → PmsProvider → StaySource → view model.
 * The UI only ever sees the view model.
 */
export async function loadSessionStay(
  access: CurrentGuestAccess,
  deps: {
    pms: PmsProvider | undefined;
    locale: Locale;
    now: Date;
    sourceOptions: StaySourceOptions;
    logger: Logger;
  },
): Promise<SessionStay> {
  if (!deps.pms) {
    deps.logger.error("stay could not be loaded", { reason: "pms-not-configured" });
    throw new StayUnavailableError();
  }
  let reservation: PmsReservation;
  try {
    reservation = await deps.pms.getReservation(access.externalReservationId);
  } catch (error) {
    logStayFailure(deps.logger, { dataSource: "session" }, error);
    throw new StayUnavailableError();
  }
  try {
    const source = toStaySource(reservation, deps.sourceOptions);
    if (
      reservation.externalId !== access.externalReservationId ||
      source.tenantId !== access.tenantId ||
      source.property.id !== access.propertyId
    ) {
      deps.logger.warn("guest access does not match reservation", {
        guestAccessId: access.guestAccessId,
      });
      return { kind: "access-invalid" };
    }
    return { kind: "stay", viewModel: buildStayViewModel(source, deps.locale, deps.now) };
  } catch (error) {
    if (error instanceof StayMappingError && error.reason === "reservation-inactive") {
      deps.logger.info("guest access for inactive reservation", {
        guestAccessId: access.guestAccessId,
      });
      return { kind: "access-invalid" };
    }
    logStayFailure(deps.logger, { dataSource: "session" }, error);
    throw new StayUnavailableError();
  }
}
