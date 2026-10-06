/**
 * Online check-in use cases (ADR 0016). Framework-free; called by the server actions.
 *
 * Security model:
 * - The registration is always the one of the reservation in the *server-side* guest
 *   context (session → guest access → reservation). No id from the browser selects it.
 * - Only fields configured for the property are accepted; everything else is dropped.
 * - Writes are rate limited per reservation and use optimistic concurrency (version).
 * - Submitting is idempotent; provider syncs run afterwards and never block the guest.
 * - Nothing personal is logged – ids, steps and outcome codes only.
 */
import {
  ADDRESS_FIELDS,
  type CheckInStep,
  type FieldError,
  fieldsForRole,
  hashSecret,
  localDateOf,
  type Logger,
  MAX_TRAVELLERS,
  missingFields,
  normalizeGuestInput,
  type RegistrationField,
  type RegistrationGuest,
  type RegistrationGuestData,
  rulesFor,
} from "@up/core";
import {
  type Database,
  hitRateLimit,
  saveRegistrationGuests,
  startRegistration,
  submitRegistration,
} from "@up/db";

import { type GuestContext } from "../guest-context/guest-context";
import { loadStayJourney, reservationKeyOf, type StayJourney } from "../journey/stay-journey";

export type CheckInDeps = {
  db: Database | undefined;
  logger: Logger;
  now: () => Date;
};

export const CHECK_IN_RATE_LIMIT = { windowMs: 15 * 60 * 1000, max: 60 } as const;

export type CheckInAvailability =
  | { available: true; journey: StayJourney }
  | {
      available: false;
      reason: "no-database" | "reservation-unavailable" | "not-enabled" | "stay-over";
    };

/** Whether this guest may use the online check-in right now. */
export async function checkInAvailability(
  deps: CheckInDeps,
  context: GuestContext,
): Promise<CheckInAvailability> {
  if (!deps.db) return { available: false, reason: "no-database" };
  if (context.reservation.status !== "loaded") {
    return { available: false, reason: "reservation-unavailable" };
  }
  const status = context.reservation.source.reservation.status;
  if (status !== "confirmed" && status !== "in-house")
    return { available: false, reason: "stay-over" };
  const journey = await loadStayJourney(
    { db: deps.db, logger: deps.logger, accessProvider: undefined },
    context,
  );
  if (!journey?.settings.registration.enabled) return { available: false, reason: "not-enabled" };
  if (journey.journey.phase === "after-departure") return { available: false, reason: "stay-over" };
  return { available: true, journey };
}

export type StepResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "rate-limited" | "conflict" | "submitted" }
  /**
   * Invalid values (nothing saved) or missing required fields (valid values saved, so the
   * progress is kept – `version` is the new version to continue with).
   */
  | { ok: false; reason: "invalid"; errors: Record<number, FieldError[]>; version?: number };

async function allowWrite(deps: CheckInDeps & { db: Database }, context: GuestContext) {
  const subject = hashSecret(
    `${context.tenantId}:${context.reservationProvider}:${context.externalReservationId}`,
  );
  const bucket = await hitRateLimit(
    deps.db,
    `check-in:${subject}`,
    CHECK_IN_RATE_LIMIT.windowMs,
    deps.now(),
  );
  return bucket.hits <= CHECK_IN_RATE_LIMIT.max;
}

/** Number of travellers from the reservation, if the PMS delivered it. */
export function reservationGuestCount(context: GuestContext): number | undefined {
  if (context.reservation.status !== "loaded") return undefined;
  const count = context.reservation.source.reservation.guestCount;
  if (!count) return undefined;
  const total = count.adults + count.children;
  return total >= 1 ? Math.min(total, MAX_TRAVELLERS) : undefined;
}

type Prepared = { db: Database; journey: StayJourney };

async function prepare(
  deps: CheckInDeps,
  context: GuestContext,
): Promise<Prepared | Exclude<StepResult, { ok: true }>> {
  const availability = await checkInAvailability(deps, context);
  if (!availability.available || !deps.db) return { ok: false, reason: "unavailable" };
  if (!(await allowWrite({ ...deps, db: deps.db }, context))) {
    deps.logger.warn("check-in rate limited", { guestAccessId: context.guestAccessId });
    return { ok: false, reason: "rate-limited" };
  }
  return { db: deps.db, journey: availability.journey };
}

function isPrepared(value: Prepared | StepResult): value is Prepared {
  return "db" in value;
}

/**
 * Step 1 "Deine Reise": creates (or refreshes) the registration. The guest count comes
 * from the reservation; only when the PMS does not know it, the guest states it.
 */
export async function confirmTrip(
  deps: CheckInDeps,
  context: GuestContext,
  input: { guestCount?: number },
): Promise<StepResult> {
  const prepared = await prepare(deps, context);
  if (!isPrepared(prepared)) return prepared;
  const { db, journey } = prepared;
  if (journey.registration?.status === "submitted") return { ok: false, reason: "submitted" };
  if (context.reservation.status !== "loaded") return { ok: false, reason: "unavailable" };
  const fromReservation = reservationGuestCount(context);
  const stated = input.guestCount;
  if (
    fromReservation === undefined &&
    (stated === undefined || !Number.isInteger(stated) || stated < 1 || stated > MAX_TRAVELLERS)
  ) {
    return { ok: false, reason: "invalid", errors: {} };
  }
  const { reservation } = context.reservation.source;
  const registration = await startRegistration(db, context, {
    ...reservationKeyOf(context),
    propertyId: context.propertyId,
    guestCount: fromReservation ?? stated ?? 1,
    guestCountSource: fromReservation === undefined ? "guest" : "reservation",
    arrivalAt: new Date(reservation.checkInAt),
    departureAt: new Date(reservation.checkOutAt),
  });
  // A guest-stated count can be corrected while the registration is a draft.
  if (fromReservation === undefined && stated !== undefined && registration.guestCount !== stated) {
    const saved = await saveRegistrationGuests(
      db,
      context,
      registration.id,
      registration.version,
      [],
      {
        guestCount: stated,
      },
    );
    if (!saved.ok)
      return { ok: false, reason: saved.reason === "submitted" ? "submitted" : "conflict" };
  }
  deps.logger.info("check-in step saved", { step: "trip", registrationId: registration.id });
  return { ok: true };
}

export type GuestStep = Extract<CheckInStep, "primary" | "companions" | "address">;

/** Fields of one step for one traveller. */
export function stepFields(
  journey: StayJourney,
  step: GuestStep,
  position: number,
): RegistrationField[] {
  const config = journey.settings.registration;
  if (step === "address") {
    return fieldsForRole(config, "primary").filter((field) => ADDRESS_FIELDS.includes(field));
  }
  const role = position === 0 ? "primary" : "companion";
  const fields = fieldsForRole(config, role);
  // Fellow travellers enter their (optional) address data on their own step.
  return position === 0 ? fields.filter((field) => !ADDRESS_FIELDS.includes(field)) : fields;
}

/** Positions edited on a step. */
export function stepPositions(journey: StayJourney, step: GuestStep): number[] {
  if (step !== "companions") return [0];
  const count = journey.registration?.guestCount ?? 1;
  return Array.from({ length: Math.max(0, count - 1) }, (_, index) => index + 1);
}

/**
 * Saves one step's values. Only the step's own fields are replaced; values of other
 * steps of the same traveller are kept. Invalid input is reported and nothing is saved.
 */
export async function saveGuestStep(
  deps: CheckInDeps,
  context: GuestContext,
  input: {
    step: GuestStep;
    version: number;
    values: Readonly<Record<number, Readonly<Record<string, unknown>>>>;
  },
): Promise<StepResult> {
  const prepared = await prepare(deps, context);
  if (!isPrepared(prepared)) return prepared;
  const { db, journey } = prepared;
  const registration = journey.registration;
  if (!registration) return { ok: false, reason: "unavailable" };
  if (registration.status === "submitted") return { ok: false, reason: "submitted" };

  const today = localDateOf(deps.now(), journey.window.timeZone);
  const errors: Record<number, FieldError[]> = {};
  const guests: RegistrationGuest[] = [];
  for (const position of stepPositions(journey, input.step)) {
    const fields = stepFields(journey, input.step, position);
    const { data, errors: fieldErrors } = normalizeGuestInput(
      input.values[position] ?? {},
      fields,
      today,
    );
    if (fieldErrors.length > 0) errors[position] = fieldErrors;
    const existing = registration.guests.find((guest) => guest.position === position)?.data ?? {};
    const kept = Object.fromEntries(
      Object.entries(existing).filter(([field]) => !fields.includes(field as RegistrationField)),
    ) as RegistrationGuestData;
    guests.push({
      position,
      role: position === 0 ? "primary" : "companion",
      data: { ...kept, ...data },
    });
  }
  if (Object.keys(errors).length > 0) return { ok: false, reason: "invalid", errors };

  const saved = await saveRegistrationGuests(db, context, registration.id, input.version, guests);
  if (!saved.ok) {
    return {
      ok: false,
      reason:
        saved.reason === "submitted"
          ? "submitted"
          : saved.reason === "conflict"
            ? "conflict"
            : "unavailable",
    };
  }
  deps.logger.info("check-in step saved", { step: input.step, registrationId: registration.id });

  const missing: Record<number, FieldError[]> = {};
  for (const guest of guests) {
    const role = guest.position === 0 ? "primary" : "companion";
    const fields = stepFields(journey, input.step, guest.position);
    const rules = rulesFor(journey.settings.registration, role, guest.data, journey.arrivalDate);
    const absent = missingFields(rules, guest.data, fields);
    if (absent.length > 0)
      missing[guest.position] = absent.map((field) => ({ field, code: "required" }));
  }
  if (Object.keys(missing).length > 0) {
    return { ok: false, reason: "invalid", errors: missing, version: saved.version };
  }
  return { ok: true };
}

export type SubmitOutcome =
  | { ok: true; registrationId: string; newlySubmitted: boolean }
  | {
      ok: false;
      reason: "unavailable" | "rate-limited" | "conflict" | "incomplete" | "not-confirmed";
    };

/** Final step: confirm and submit. Idempotent; syncs are queued, not awaited. */
export async function submitCheckIn(
  deps: CheckInDeps,
  context: GuestContext,
  input: { version: number; confirmed: boolean },
): Promise<SubmitOutcome> {
  const prepared = await prepare(deps, context);
  if (!isPrepared(prepared)) {
    return {
      ok: false,
      reason: prepared.reason === "rate-limited" ? "rate-limited" : "unavailable",
    };
  }
  const { db, journey } = prepared;
  const registration = journey.registration;
  if (!registration) return { ok: false, reason: "unavailable" };
  if (registration.status === "submitted") {
    return { ok: true, registrationId: registration.id, newlySubmitted: false };
  }
  if (!input.confirmed) return { ok: false, reason: "not-confirmed" };
  if (!journey.assessment.readyToSubmit) return { ok: false, reason: "incomplete" };

  const config = journey.settings.registration;
  const now = deps.now();
  const purgeAfter =
    config.retentionDaysAfterDeparture === undefined
      ? undefined
      : new Date(
          new Date(journey.window.checkOutAt).getTime() +
            config.retentionDaysAfterDeparture * 86_400_000,
        );
  const result = await submitRegistration(db, context, registration.id, {
    expectedVersion: input.version,
    targets: config.targets,
    now,
    ...(purgeAfter ? { purgeAfter } : {}),
  });
  if (!result.ok)
    return { ok: false, reason: result.reason === "conflict" ? "conflict" : "unavailable" };
  deps.logger.info("check-in submitted", {
    registrationId: registration.id,
    targets: config.targets,
    alreadySubmitted: result.alreadySubmitted,
  });
  return { ok: true, registrationId: registration.id, newlySubmitted: !result.alreadySubmitted };
}
