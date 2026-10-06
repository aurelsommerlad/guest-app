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
 *
 * Source of truth: the reservation decides how many people travel (occupancy); the guest
 * never chooses the number. PMS guest data prefills empty slots; nothing is written to
 * the PMS here (that is the separate, flag-guarded write-back).
 */
import {
  ADDRESS_FIELDS,
  type CheckInStep,
  type FieldError,
  fieldsForRole,
  guestStepFields,
  hashSecret,
  localDateOf,
  type Logger,
  MAX_TRAVELLERS,
  missingFields,
  normalizeGuestInput,
  type PmsProvider,
  prefillGuests,
  type ReservationProvider,
  type RegistrationField,
  type RegistrationGuest,
  type RegistrationGuestData,
  ROLE_MANDATORY_FIELDS,
  rulesFor,
} from "@up/core";
import {
  type Database,
  hitRateLimit,
  type GuestRegistrationRecord,
  saveRegistrationGuests,
  seedRegistrationGuests,
  startRegistration,
  submitRegistration,
  syncRegistrationOccupancy,
} from "@up/db";

import { type GuestContext } from "../guest-context/guest-context";
import { loadStayJourney, reservationKeyOf, type StayJourney } from "../journey/stay-journey";

export type CheckInDeps = {
  db: Database | undefined;
  logger: Logger;
  now: () => Date;
  /** PMS of the reservation – for prefilling guest data (optional). */
  pmsFor?: (provider: ReservationProvider) => PmsProvider | undefined;
};

export const CHECK_IN_RATE_LIMIT = { windowMs: 15 * 60 * 1000, max: 60 } as const;

export type CheckInAvailability =
  | { available: true; journey: StayJourney }
  | {
      available: false;
      reason:
        | "no-database"
        | "reservation-unavailable"
        | "not-enabled"
        | "stay-over"
        /** The reservation does not say how many people travel – never guessed or asked. */
        | "occupancy-unknown";
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
  const journeyDeps = { db: deps.db, logger: deps.logger, accessProvider: undefined };
  let journey = await loadStayJourney(journeyDeps, context);
  if (!journey?.settings.registration.enabled) return { available: false, reason: "not-enabled" };
  if (journey.journey.phase === "after-departure") return { available: false, reason: "stay-over" };
  const occupancy = reservationGuestCount(context);
  if (occupancy === undefined) return { available: false, reason: "occupancy-unknown" };
  // The reservation changed the number of travellers while the check-in is a draft.
  const registration = journey.registration;
  if (
    registration?.status === "draft" &&
    registration.guestCountSource === "reservation" &&
    registration.guestCount !== occupancy &&
    (await syncRegistrationOccupancy(deps.db, context, registration.id, occupancy, deps.now()))
  ) {
    deps.logger.info("check-in occupancy changed", { registrationId: registration.id });
    journey = (await loadStayJourney(journeyDeps, context)) ?? journey;
    if (journey.registration) {
      await seedFromPms(deps, deps.db, context, journey, journey.registration);
      journey = (await loadStayJourney(journeyDeps, context)) ?? journey;
    }
  }
  return { available: true, journey };
}

/**
 * Prefills empty person slots from the PMS (never overwrites guest input). PMS failures
 * only mean "no prefill" – the guest then enters the data.
 */
async function seedFromPms(
  deps: CheckInDeps,
  db: Database,
  context: GuestContext,
  journey: StayJourney,
  registration: GuestRegistrationRecord,
): Promise<void> {
  const pms = deps.pmsFor?.(context.reservationProvider);
  if (!pms?.getReservationGuests) return;
  const filled = new Set(registration.guests.map((guest) => guest.position));
  if (filled.size >= registration.guestCount) return;
  try {
    const pmsGuests = await pms.getReservationGuests(context.externalReservationId);
    const slots = prefillGuests(
      journey.settings.registration,
      pmsGuests,
      registration.guestCount,
      localDateOf(deps.now(), journey.window.timeZone),
    ).filter((slot) => !filled.has(slot.position));
    const seeded = await seedRegistrationGuests(db, context, registration.id, slots);
    deps.logger.info("check-in prefilled from reservation", {
      registrationId: registration.id,
      slots: seeded,
    });
  } catch (error) {
    deps.logger.warn("check-in prefill unavailable", {
      registrationId: registration.id,
      error: error instanceof Error ? { name: error.name } : "unknown",
    });
  }
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
 * Step 1 "Deine Reise": creates the registration with exactly the reservation's number of
 * travellers and prefills the slots the PMS already knows.
 */
export async function confirmTrip(deps: CheckInDeps, context: GuestContext): Promise<StepResult> {
  const prepared = await prepare(deps, context);
  if (!isPrepared(prepared)) return prepared;
  const { db, journey } = prepared;
  if (journey.registration?.status === "submitted") return { ok: false, reason: "submitted" };
  const occupancy = reservationGuestCount(context);
  if (context.reservation.status !== "loaded" || occupancy === undefined) {
    return { ok: false, reason: "unavailable" };
  }
  const { reservation } = context.reservation.source;
  const registration = await startRegistration(db, context, {
    ...reservationKeyOf(context),
    propertyId: context.propertyId,
    guestCount: occupancy,
    guestCountSource: "reservation",
    arrivalAt: new Date(reservation.checkInAt),
    departureAt: new Date(reservation.checkOutAt),
  });
  await seedFromPms(deps, db, context, journey, registration);
  deps.logger.info("check-in step saved", { step: "trip", registrationId: registration.id });
  return { ok: true };
}

export type GuestStep = Extract<CheckInStep, "guests" | "address">;

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
  return guestStepFields(config, position);
}

/** Positions edited on a step: all booked travellers on "guests", the main guest on "address". */
export function stepPositions(journey: StayJourney, step: GuestStep): number[] {
  if (step === "address") return [0];
  const count = journey.registration?.guestCount ?? 1;
  return Array.from({ length: count }, (_, index) => index);
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
  if (Object.keys(errors).length > 0) {
    // Nothing is saved; still name every missing required field so the guest sees all at once.
    for (const [position, absent] of Object.entries(
      missingByPosition(journey, input.step, guests),
    )) {
      const known = new Set((errors[Number(position)] ?? []).map((error) => error.field));
      const extra = absent.filter((error) => !known.has(error.field));
      if (extra.length > 0)
        errors[Number(position)] = [...(errors[Number(position)] ?? []), ...extra];
    }
    return { ok: false, reason: "invalid", errors };
  }

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

  const missing = missingByPosition(journey, input.step, guests);
  if (Object.keys(missing).length > 0) {
    return { ok: false, reason: "invalid", errors: missing, version: saved.version };
  }
  return { ok: true };
}

/** Required fields of the step each traveller still lacks. */
function missingByPosition(
  journey: StayJourney,
  step: GuestStep,
  guests: readonly RegistrationGuest[],
): Record<number, FieldError[]> {
  const missing: Record<number, FieldError[]> = {};
  for (const guest of guests) {
    const role = guest.position === 0 ? "primary" : "companion";
    const fields = stepFields(journey, step, guest.position);
    const rules = rulesFor(journey.settings.registration, role, guest.data, journey.arrivalDate);
    // Age unknown: only flag what every traveller needs – whether e.g. the nationality is
    // required depends on the birth date (child rules), which is flagged itself.
    const children = journey.settings.registration.children;
    const absent = missingFields(rules, guest.data, fields).filter(
      (field) =>
        role === "primary" ||
        guest.data.birthDate !== undefined ||
        !children ||
        children.required.includes(field) ||
        ROLE_MANDATORY_FIELDS.companion.includes(field),
    );
    if (absent.length > 0)
      missing[guest.position] = absent.map((field) => ({ field, code: "required" }));
  }
  return missing;
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
