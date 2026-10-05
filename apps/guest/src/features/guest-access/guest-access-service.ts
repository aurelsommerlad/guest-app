/**
 * Guest access use cases (ADR 0011). Framework-free and dependency-injected, so the
 * same code runs in route handlers, server actions, the CLI and tests.
 *
 * Both entry paths – personal link and booking number + last name – end in
 * `startSession`, i.e. in exactly the same kind of guest session.
 *
 * Never logged: link tokens, session secrets, booking numbers, last names.
 */
import {
  computeAccessWindow,
  evaluateAccess,
  generateSecret,
  type GuestAccess,
  hashSecret,
  isExternalProvider,
  isWellFormedSecret,
  lastNameMatches,
  type Logger,
  normalizeBookingReference,
  type PmsProvider,
  type ReservationProvider,
} from "@up/core";
import {
  createGuestAccess,
  createGuestSession,
  type Database,
  findGuestAccessByTokenHash,
  findGuestAccessForReservation,
  findGuestSessionByTokenHash,
  getTenantBySlug,
  markGuestAccessUsed,
  resolveExternalMapping,
  revokeGuestSession,
} from "@up/db";

import { checkLoginRateLimit } from "./rate-limit";
import { safeErrorFields } from "./safe-error";

/** Upper bound of a session; it never outlives its guest access. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type GuestAccessDeps = {
  db: Database;
  logger: Logger;
  now: () => Date;
};

export type SessionGrant = { secret: string; expiresAt: Date };

/** What the current guest may see – resolved from the session on every request. */
export type CurrentGuestAccess = {
  guestAccessId: string;
  tenantId: string;
  propertyId: string;
  unitId?: string;
  reservationProvider: ReservationProvider;
  externalReservationId: string;
};

async function startSession(
  deps: GuestAccessDeps,
  access: GuestAccess,
  previousSessionSecret: string | undefined,
): Promise<SessionGrant> {
  const now = deps.now();
  const tenant = { tenantId: access.tenantId };
  // Never continue an existing session: a fresh secret on every entry (no fixation).
  if (previousSessionSecret && isWellFormedSecret(previousSessionSecret)) {
    await revokeGuestSession(deps.db, hashSecret(previousSessionSecret), now);
  }
  const secret = generateSecret();
  const expiresAt = new Date(
    Math.min(now.getTime() + SESSION_MAX_AGE_MS, access.validUntil.getTime()),
  );
  await createGuestSession(deps.db, tenant, {
    guestAccessId: access.id,
    tokenHash: hashSecret(secret),
    expiresAt,
  });
  await markGuestAccessUsed(deps.db, tenant, access.id, now);
  return { secret, expiresAt };
}

/** Personal link: token → guest access → new session. Undefined for every failure. */
export async function enterWithLinkToken(
  deps: GuestAccessDeps,
  token: string,
  previousSessionSecret?: string,
): Promise<SessionGrant | undefined> {
  const log = deps.logger.child({ flow: "guest-link" });
  try {
    if (!isWellFormedSecret(token)) {
      log.info("guest link rejected", { reason: "malformed" });
      return undefined;
    }
    const access = await findGuestAccessByTokenHash(deps.db, hashSecret(token));
    if (!access) {
      log.info("guest link rejected", { reason: "unknown" });
      return undefined;
    }
    const state = evaluateAccess(access, deps.now());
    if (state !== "valid") {
      log.info("guest link rejected", { reason: state, guestAccessId: access.id });
      return undefined;
    }
    const grant = await startSession(deps, access, previousSessionSecret);
    log.info("guest session started", { via: "link", guestAccessId: access.id });
    return grant;
  } catch (error) {
    log.error("guest link failed", { error: safeErrorFields(error) });
    return undefined;
  }
}

/** Session cookie → current guest access. Revoked/expired session or access → undefined. */
export async function resolveGuestSession(
  deps: GuestAccessDeps,
  sessionSecret: string | undefined,
): Promise<CurrentGuestAccess | undefined> {
  if (!sessionSecret || !isWellFormedSecret(sessionSecret)) return undefined;
  try {
    const now = deps.now();
    const record = await findGuestSessionByTokenHash(deps.db, hashSecret(sessionSecret), now);
    if (!record || evaluateAccess(record.access, now) !== "valid") return undefined;
    const { access } = record;
    return {
      guestAccessId: access.id,
      tenantId: access.tenantId,
      propertyId: access.propertyId,
      ...(access.unitId ? { unitId: access.unitId } : {}),
      reservationProvider: access.reservationProvider,
      externalReservationId: access.externalReservationId,
    };
  } catch (error) {
    deps.logger.error("guest session lookup failed", { error: safeErrorFields(error) });
    return undefined;
  }
}

export type LoginInput = {
  tenantSlug: string | undefined;
  bookingReference: string;
  lastName: string;
  clientAddress: string;
};

/** The UI distinguishes only these two failures – never *why* a login did not match. */
export type LoginOutcome =
  | { ok: true; session: SessionGrant }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "rate-limited"; retryAfterSeconds: number };

const NOT_FOUND = { ok: false, reason: "not-found" } as const;

/**
 * Booking number + last name → reservation → existing or new guest access → session.
 * Applies the same rules as the link: time window, revocation, reservation status.
 */
export async function loginWithBookingReference(
  deps: GuestAccessDeps & {
    pms: { provider: ReservationProvider; pms: PmsProvider } | undefined;
  },
  input: LoginInput,
  previousSessionSecret?: string,
): Promise<LoginOutcome> {
  const log = deps.logger.child({ flow: "guest-login" });
  const reject = (reason: string): LoginOutcome => {
    log.info("guest login rejected", { reason });
    return NOT_FOUND;
  };
  try {
    const now = deps.now();
    const bookingReference = normalizeBookingReference(input.bookingReference);
    const limit = await checkLoginRateLimit(
      deps.db,
      { clientAddress: input.clientAddress, ...(bookingReference ? { bookingReference } : {}) },
      now,
    );
    if (!limit.allowed) {
      log.warn("guest login rate limited");
      return { ok: false, reason: "rate-limited", retryAfterSeconds: limit.retryAfterSeconds };
    }
    if (!bookingReference) return reject("malformed-reference");

    const tenant = input.tenantSlug ? await getTenantBySlug(deps.db, input.tenantSlug) : undefined;
    if (!tenant) {
      log.error("guest login not configured", { missing: "tenant" });
      return NOT_FOUND;
    }
    if (!deps.pms) {
      log.error("guest login not configured", { missing: "pms" });
      return NOT_FOUND;
    }
    const context = { tenantId: tenant.id };

    const candidates = await deps.pms.pms.findReservationsByBookingReference(bookingReference);
    if (candidates.length === 0) return reject("unknown-reference");
    const matching = candidates.filter((candidate) =>
      lastNameMatches(input.lastName, candidate.primaryGuestLastName),
    );
    if (matching.length === 0) return reject("name-mismatch");
    if (matching.length > 1) return reject("ambiguous");
    const reservation = matching[0]?.reservation;
    if (!reservation) return reject("unknown-reference");
    if (reservation.status === "canceled" || reservation.status === "no-show") {
      return reject("reservation-inactive");
    }

    // Identity only via stable external ids of *this* tenant – never via names.
    if (!isExternalProvider(reservation.provider)) return reject("unknown-property");
    const propertyId = await resolveExternalMapping(deps.db, context, {
      provider: reservation.provider,
      entityType: "property",
      externalId: reservation.externalPropertyId,
    });
    if (!propertyId) return reject("unknown-property");
    const unitId = reservation.externalUnitId
      ? await resolveExternalMapping(deps.db, context, {
          provider: reservation.provider,
          entityType: "unit",
          externalId: reservation.externalUnitId,
        })
      : undefined;

    const reservationKey = {
      provider: deps.pms.provider,
      externalReservationId: reservation.externalId,
    };
    const existing = await findGuestAccessForReservation(deps.db, context, reservationKey);
    let access = existing.find(
      (candidate) =>
        candidate.propertyId === propertyId && evaluateAccess(candidate, now) === "valid",
    );
    if (!access) {
      // A revoked access blocks the reservation – the login must not reopen it.
      if (existing.some((candidate) => candidate.revokedAt)) return reject("revoked");
      const window = computeAccessWindow(reservation);
      if (evaluateAccess(window, now) !== "valid") return reject("outside-window");
      // Same kind of record as a link access; its token is never handed out.
      access = await createGuestAccess(deps.db, context, {
        propertyId,
        ...(unitId ? { unitId } : {}),
        reservationProvider: reservationKey.provider,
        externalReservationId: reservationKey.externalReservationId,
        tokenHash: hashSecret(generateSecret()),
        ...window,
      });
    }

    const session = await startSession(deps, access, previousSessionSecret);
    log.info("guest session started", { via: "login", guestAccessId: access.id });
    return { ok: true, session };
  } catch (error) {
    log.error("guest login failed", { error: safeErrorFields(error) });
    return NOT_FOUND;
  }
}
