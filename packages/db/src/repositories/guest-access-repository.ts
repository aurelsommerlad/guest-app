/**
 * Guest access and guest sessions (ADR 0011).
 *
 * Lookups by secret hash (`findGuestAccessByTokenHash`, `findGuestSessionByTokenHash`) are
 * the only reads without a TenantContext: the high-entropy secret *is* the credential
 * that determines the tenant (like `getTenantBySlug`). Everything else is tenant-scoped.
 * Inputs are hashes – plaintext secrets never reach this module.
 */
import {
  type GuestAccess,
  isEntityKey,
  isReservationProvider,
  isSecretHash,
  type ReservationProvider,
  type TenantContext,
} from "@up/core";
import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { type Database } from "../client";
import { guestAccess, guestSessions } from "../schema";

const accessColumns = {
  id: guestAccess.id,
  tenantId: guestAccess.tenantId,
  propertyId: guestAccess.propertyId,
  unitId: guestAccess.unitId,
  reservationProvider: guestAccess.reservationProvider,
  externalReservationId: guestAccess.externalReservationId,
  validFrom: guestAccess.validFrom,
  validUntil: guestAccess.validUntil,
  revokedAt: guestAccess.revokedAt,
};

type AccessRow = {
  id: string;
  tenantId: string;
  propertyId: string;
  unitId: string | null;
  reservationProvider: ReservationProvider;
  externalReservationId: string;
  validFrom: Date;
  validUntil: Date;
  revokedAt: Date | null;
};

function toGuestAccess(row: AccessRow): GuestAccess {
  const { unitId, revokedAt, ...rest } = row;
  return {
    ...rest,
    ...(unitId === null ? {} : { unitId }),
    ...(revokedAt === null ? {} : { revokedAt }),
  };
}

function assertTenantContext(context: TenantContext): void {
  if (!isEntityKey(context.tenantId)) throw new TypeError("Invalid tenant context");
}

function assertHash(hash: string): void {
  if (!isSecretHash(hash)) throw new TypeError("Expected a SHA-256 hex hash");
}

function assertProvider(provider: string): void {
  if (!isReservationProvider(provider)) throw new TypeError("Unsupported reservation provider");
}

export type NewGuestAccess = {
  propertyId: string;
  unitId?: string;
  reservationProvider: ReservationProvider;
  externalReservationId: string;
  tokenHash: string;
  validFrom: Date;
  validUntil: Date;
};

export async function createGuestAccess(
  db: Database,
  context: TenantContext,
  input: NewGuestAccess,
): Promise<GuestAccess> {
  assertTenantContext(context);
  assertHash(input.tokenHash);
  assertProvider(input.reservationProvider);
  const [row] = await db
    .insert(guestAccess)
    .values({ ...input, tenantId: context.tenantId, unitId: input.unitId ?? null })
    .returning(accessColumns);
  if (!row) throw new Error("Guest access was not created");
  return toGuestAccess(row);
}

/** Resolves a link token hash. Validity (time, revocation) is evaluated by the caller. */
export async function findGuestAccessByTokenHash(
  db: Database,
  tokenHash: string,
): Promise<GuestAccess | undefined> {
  if (!isSecretHash(tokenHash)) return undefined;
  const [row] = await db
    .select(accessColumns)
    .from(guestAccess)
    .where(eq(guestAccess.tokenHash, tokenHash));
  return row ? toGuestAccess(row) : undefined;
}

/** All guest access records of one reservation, newest first. */
export async function findGuestAccessForReservation(
  db: Database,
  context: TenantContext,
  reservation: { provider: ReservationProvider; externalReservationId: string },
): Promise<GuestAccess[]> {
  assertTenantContext(context);
  assertProvider(reservation.provider);
  const rows = await db
    .select(accessColumns)
    .from(guestAccess)
    .where(
      and(
        eq(guestAccess.tenantId, context.tenantId),
        eq(guestAccess.reservationProvider, reservation.provider),
        eq(guestAccess.externalReservationId, reservation.externalReservationId),
      ),
    )
    .orderBy(desc(guestAccess.createdAt));
  return rows.map(toGuestAccess);
}

export async function markGuestAccessUsed(
  db: Database,
  context: TenantContext,
  guestAccessId: string,
  now: Date,
): Promise<void> {
  assertTenantContext(context);
  await db
    .update(guestAccess)
    .set({ lastUsedAt: now })
    .where(and(eq(guestAccess.tenantId, context.tenantId), eq(guestAccess.id, guestAccessId)));
}

/**
 * Revokes all not yet revoked guest access of a reservation. Their sessions stop working
 * on the next request (sessions are always checked together with their access).
 */
export async function revokeGuestAccessForReservation(
  db: Database,
  context: TenantContext,
  reservation: { provider: ReservationProvider; externalReservationId: string },
  now: Date,
): Promise<number> {
  assertTenantContext(context);
  assertProvider(reservation.provider);
  const revoked = await db
    .update(guestAccess)
    .set({ revokedAt: now })
    .where(
      and(
        eq(guestAccess.tenantId, context.tenantId),
        eq(guestAccess.reservationProvider, reservation.provider),
        eq(guestAccess.externalReservationId, reservation.externalReservationId),
        isNull(guestAccess.revokedAt),
      ),
    )
    .returning({ id: guestAccess.id });
  return revoked.length;
}

export async function createGuestSession(
  db: Database,
  context: TenantContext,
  input: { guestAccessId: string; tokenHash: string; expiresAt: Date },
): Promise<{ id: string; expiresAt: Date }> {
  assertTenantContext(context);
  assertHash(input.tokenHash);
  const [row] = await db
    .insert(guestSessions)
    .values({ ...input, tenantId: context.tenantId })
    .returning({ id: guestSessions.id, expiresAt: guestSessions.expiresAt });
  if (!row) throw new Error("Guest session was not created");
  return row;
}

export type GuestSessionRecord = {
  session: { id: string; expiresAt: Date };
  access: GuestAccess;
};

/**
 * A session that is neither revoked nor expired, together with its guest access.
 * The access itself (time window, revocation) is evaluated by the caller.
 */
export async function findGuestSessionByTokenHash(
  db: Database,
  tokenHash: string,
  now: Date,
): Promise<GuestSessionRecord | undefined> {
  if (!isSecretHash(tokenHash)) return undefined;
  const [row] = await db
    .select({ sessionId: guestSessions.id, expiresAt: guestSessions.expiresAt, ...accessColumns })
    .from(guestSessions)
    .innerJoin(
      guestAccess,
      and(
        eq(guestAccess.tenantId, guestSessions.tenantId),
        eq(guestAccess.id, guestSessions.guestAccessId),
      ),
    )
    .where(
      and(
        eq(guestSessions.tokenHash, tokenHash),
        isNull(guestSessions.revokedAt),
        gt(guestSessions.expiresAt, now),
      ),
    );
  if (!row) return undefined;
  const { sessionId, expiresAt, ...access } = row;
  return { session: { id: sessionId, expiresAt }, access: toGuestAccess(access) };
}

/** Ends a session (e.g. when a new one replaces it). Unknown hashes are ignored. */
export async function revokeGuestSession(
  db: Database,
  tokenHash: string,
  now: Date,
): Promise<void> {
  if (!isSecretHash(tokenHash)) return;
  await db
    .update(guestSessions)
    .set({ revokedAt: now })
    .where(and(eq(guestSessions.tokenHash, tokenHash), isNull(guestSessions.revokedAt)));
}
