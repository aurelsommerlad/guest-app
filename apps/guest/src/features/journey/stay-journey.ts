/**
 * The guest's journey for the current stay (ADR 0016/0017): settings, canonical
 * registration and access decision in one place – read by STAY and the check-in flow.
 * Framework-free and dependency-injected; the request wiring lives in server.ts.
 *
 * Failure policy: a database or settings problem never breaks STAY – the journey then
 * shows no check-in and manual access, and the problem is logged (no guest data).
 */
import {
  type AccessCredential,
  type AccessProvider,
  assessRegistration,
  deriveGuestJourney,
  getAccessForStay,
  type GuestJourney,
  localDateOf,
  type Logger,
  type RegistrationAssessment,
  type RegistrationProgress,
  type StayAccess,
} from "@up/core";
import {
  type Database,
  getJourneySettings,
  getRegistrationForReservation,
  type GuestRegistrationRecord,
  type JourneySettings,
} from "@up/db";

import { type GuestContext } from "../guest-context/guest-context";

export type JourneyDeps = {
  db: Database | undefined;
  logger: Logger;
  /** Access system for key box/smart lock properties; undefined → manual instructions. */
  accessProvider: AccessProvider | undefined;
};

export type StayJourney = {
  journey: GuestJourney;
  settings: JourneySettings;
  registration: GuestRegistrationRecord | undefined;
  assessment: RegistrationAssessment;
  access: StayAccess;
  window: { checkInAt: string; checkOutAt: string; timeZone: string };
  /** Property-local arrival date (YYYY-MM-DD) – children rules, birth date limits. */
  arrivalDate: string;
};

const FALLBACK_SETTINGS: JourneySettings = {
  registration: {
    enabled: false,
    country: "DE",
    targets: [],
    primaryGuest: { required: ["firstName", "lastName"], optional: [] },
    companions: { required: ["firstName", "lastName"], optional: [] },
    guestCardRelevant: false,
    providerSettings: {},
  },
  access: { mode: "manual", release: "arrival-day", requiresCompletedRegistration: false },
  configured: false,
};

function progressOf(
  enabled: boolean,
  registration: GuestRegistrationRecord | undefined,
): RegistrationProgress {
  if (!enabled) return "not-required";
  if (!registration) return "not-started";
  return registration.status === "submitted" ? "completed" : "in-progress";
}

export function reservationKeyOf(context: GuestContext) {
  return {
    reservationProvider: context.reservationProvider,
    externalReservationId: context.externalReservationId,
  };
}

async function loadSettings(deps: JourneyDeps, context: GuestContext) {
  if (!deps.db) return { settings: FALLBACK_SETTINGS, registration: undefined };
  try {
    const settings = await getJourneySettings(deps.db, context, context.propertyId);
    const registration = settings.registration.enabled
      ? await getRegistrationForReservation(deps.db, context, reservationKeyOf(context))
      : undefined;
    return { settings, registration };
  } catch (error) {
    deps.logger.error("guest journey could not be loaded", {
      propertyId: context.propertyId,
      error: error instanceof Error ? { name: error.name } : "unknown",
    });
    return { settings: FALLBACK_SETTINGS, registration: undefined };
  }
}

/** Undefined while the reservation is not loaded (STAY shows its error state then). */
export async function loadStayJourney(
  deps: JourneyDeps,
  context: GuestContext,
  options: { includeAccessCode?: boolean } = {},
): Promise<StayJourney | undefined> {
  if (context.reservation.status !== "loaded") return undefined;
  const { source } = context.reservation;
  const window = {
    checkInAt: source.reservation.checkInAt,
    checkOutAt: source.reservation.checkOutAt,
    timeZone: context.property.timeZone,
  };
  const arrivalDate = localDateOf(new Date(window.checkInAt), window.timeZone);
  const { settings, registration } = await loadSettings(deps, context);
  const progress = progressOf(settings.registration.enabled, registration);
  const assessment = assessRegistration(settings.registration, registration, arrivalDate);

  const access = await getAccessForStay({
    config: settings.access,
    window,
    registrationCompleted: progress === "completed" || progress === "not-required",
    now: context.now,
    includeDisplayValue: options.includeAccessCode === true,
    loadCredential: async (): Promise<AccessCredential | undefined> => {
      if (!deps.accessProvider) return undefined;
      try {
        return await deps.accessProvider.getCredential({
          tenantId: context.tenantId,
          propertyId: context.propertyId,
          ...(context.unitId ? { unitId: context.unitId } : {}),
          reservation: {
            provider: context.reservationProvider,
            externalReservationId: context.externalReservationId,
          },
          checkInAt: window.checkInAt,
          checkOutAt: window.checkOutAt,
        });
      } catch (error) {
        deps.logger.error("access credential could not be loaded", {
          propertyId: context.propertyId,
          error: error instanceof Error ? { name: error.name } : "unknown",
        });
        return undefined;
      }
    },
  });

  return {
    journey: deriveGuestJourney({
      window,
      now: context.now,
      registration: progress,
      access: access.status,
    }),
    settings,
    registration,
    assessment,
    access,
    window,
    arrivalDate,
  };
}
