/**
 * Canonical guest registrations and their target syncs (ADR 0016).
 *
 * - One registration per reservation (unique key), found only via the reservation the
 *   guest session belongs to – never via an id from the browser.
 * - Drafts are written with optimistic concurrency (version); submitted registrations
 *   are immutable for the guest.
 * - Submitting is idempotent: the status flips once, sync rows are created once per target
 *   (unique (registration_id, provider)).
 * - The sync worker functions (claimDueSyncs, purgeExpiredRegistrationData) are system
 *   operations across tenants and return tenant ids; every follow-up call is tenant-scoped.
 */
import {
  assessAddress,
  type BillingChoice,
  type GuestCountSource,
  type GuestRegistration,
  isEntityKey,
  isReservationProvider,
  MAX_TRAVELLERS,
  REGISTRATION_FIELDS,
  type RegistrationField,
  type RegistrationGuest,
  type RegistrationGuestData,
  type RegistrationTarget,
  type ReservationProvider,
  type SyncErrorCode,
  type SyncStatus,
  type TenantContext,
} from "@up/core";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";

import { type Database } from "../client";
import {
  contactVerificationChallenges,
  contactVerificationEvents,
  guestRegistrationBilling,
  guestRegistrationContacts,
  guestRegistrationGuests,
  guestRegistrations,
  guestRegistrationSyncs,
} from "../schema";

export type ReservationKey = {
  reservationProvider: ReservationProvider;
  externalReservationId: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function assertTenantContext(context: TenantContext): void {
  if (!isEntityKey(context.tenantId)) throw new TypeError("Invalid tenant context");
}

function assertReservationKey(key: ReservationKey): void {
  if (!isReservationProvider(key.reservationProvider)) throw new TypeError("Invalid provider");
  const id = key.externalReservationId;
  if (id.trim().length === 0 || id.length > 255) throw new TypeError("Invalid reservation id");
}

type GuestRow = typeof guestRegistrationGuests.$inferSelect;
type ContactRow = typeof guestRegistrationContacts.$inferSelect;
type BillingRow = typeof guestRegistrationBilling.$inferSelect;

/** Legal registration fields (guest_registration_guests) – contact data lives apart. */
const LEGAL_COLUMNS = [
  "firstName",
  "lastName",
  "birthDate",
  "nationality",
  "street",
  "postalCode",
  "city",
  "country",
  "documentType",
  "documentNumber",
] as const satisfies readonly RegistrationField[];

type GuestColumns = Pick<
  GuestRow,
  (typeof LEGAL_COLUMNS)[number] | "addressSource" | "addressStatus"
>;

/**
 * Canonical guest → legal columns. One place, so the model never leaks column names. A
 * fellow traveller with the main guest's address stores no own address (a reference).
 */
function toColumns(
  guest: Pick<RegistrationGuest, "position" | "data" | "addressSource">,
): GuestColumns {
  const shared = guest.position > 0 && guest.addressSource === "same-as-primary";
  const data = guest.data;
  const own = (value: string | undefined) => (shared ? null : (value ?? null));
  const address = {
    ...(data.street ? { street: data.street } : {}),
    ...(data.postalCode ? { postalCode: data.postalCode } : {}),
    ...(data.city ? { city: data.city } : {}),
    ...(data.country ? { country: data.country } : {}),
  };
  const hasAddress = Object.keys(address).length > 0;
  return {
    firstName: data.firstName ?? null,
    lastName: data.lastName ?? null,
    birthDate: data.birthDate ?? null,
    nationality: data.nationality ?? null,
    street: own(data.street),
    postalCode: own(data.postalCode),
    city: own(data.city),
    country: own(data.country),
    documentType: (data.documentType as GuestColumns["documentType"]) ?? null,
    documentNumber: data.documentNumber ?? null,
    addressSource: shared ? "same-as-primary" : "own",
    // Formal plausibility only – no provider is asked (ADR 0021).
    addressStatus: shared || !hasAddress ? null : assessAddress(address).status,
  };
}

function toGuest(row: GuestRow, contact?: ContactRow): RegistrationGuest {
  const data: RegistrationGuestData = {};
  for (const field of LEGAL_COLUMNS) {
    const value = row[field];
    if (value !== null) data[field] = value;
  }
  if (contact?.email) data.email = contact.email;
  if (contact?.phone) data.phone = contact.phone;
  const prefilled = REGISTRATION_FIELDS.filter((field) => row.prefilledFields.includes(field));
  return {
    position: row.position,
    role: row.role,
    data,
    ...(prefilled.length > 0 ? { prefilledFields: prefilled } : {}),
    ...(row.addressSource === "same-as-primary" ? { addressSource: row.addressSource } : {}),
  };
}

/** Provenance after a save: a prefilled field stays "from the PMS" only while unchanged. */
function keptPrefilled(
  previous: GuestRow | undefined,
  contact: ContactRow | undefined,
  data: RegistrationGuestData,
): string[] {
  if (!previous) return [];
  const before = toGuest(previous, contact);
  return (before.prefilledFields ?? []).filter((field) => before.data[field] === data[field]);
}

function toBilling(row: BillingRow | undefined): BillingChoice | undefined {
  if (!row) return undefined;
  if (row.kind === "private") return { kind: "private" };
  return {
    kind: "company",
    companyName: row.companyName ?? "",
    street: row.street ?? "",
    ...(row.postalCode ? { postalCode: row.postalCode } : {}),
    city: row.city ?? "",
    country: row.country ?? "",
    ...(row.vatId ? { vatId: row.vatId } : {}),
    ...(row.contactFirstName && row.contactLastName
      ? { contactPerson: { firstName: row.contactFirstName, lastName: row.contactLastName } }
      : {}),
  };
}

type RegistrationRow = typeof guestRegistrations.$inferSelect;

export type GuestRegistrationRecord = GuestRegistration & {
  arrivalAt: Date;
  departureAt: Date;
  purgedAt?: Date;
};

function toRecord(
  row: RegistrationRow,
  guests: readonly GuestRow[],
  contacts: readonly ContactRow[] = [],
  billing?: BillingRow,
): GuestRegistrationRecord {
  const contactAt = (position: number) =>
    contacts.find((contact) => contact.registrationId === row.id && contact.position === position);
  const billingChoice = toBilling(billing);
  return {
    id: row.id,
    tenantId: row.tenantId,
    propertyId: row.propertyId,
    reservationProvider: row.reservationProvider,
    externalReservationId: row.externalReservationId,
    status: row.status,
    guestCount: row.guestCount,
    guestCountSource: row.guestCountSource,
    guests: guests
      .filter((guest) => guest.registrationId === row.id)
      .sort((a, b) => a.position - b.position)
      .map((guest) => toGuest(guest, contactAt(guest.position))),
    ...(billingChoice ? { billing: billingChoice } : {}),
    arrivalAt: row.arrivalAt,
    departureAt: row.departureAt,
    ...(row.submittedAt ? { submittedAt: row.submittedAt } : {}),
    ...(row.guestCountChangedAt ? { guestCountChangedAt: row.guestCountChangedAt } : {}),
    ...(row.purgeAfter ? { purgeAfter: row.purgeAfter } : {}),
    ...(row.purgedAt ? { purgedAt: row.purgedAt } : {}),
    version: row.version,
  };
}

async function withGuests(
  db: Pick<Database, "select">,
  context: TenantContext,
  row: RegistrationRow | undefined,
): Promise<GuestRegistrationRecord | undefined> {
  if (!row) return undefined;
  const guests = await db
    .select()
    .from(guestRegistrationGuests)
    .where(
      and(
        eq(guestRegistrationGuests.tenantId, context.tenantId),
        eq(guestRegistrationGuests.registrationId, row.id),
      ),
    )
    .orderBy(asc(guestRegistrationGuests.position));
  const contacts = await db
    .select()
    .from(guestRegistrationContacts)
    .where(
      and(
        eq(guestRegistrationContacts.tenantId, context.tenantId),
        eq(guestRegistrationContacts.registrationId, row.id),
      ),
    );
  const [billing] = await db
    .select()
    .from(guestRegistrationBilling)
    .where(
      and(
        eq(guestRegistrationBilling.tenantId, context.tenantId),
        eq(guestRegistrationBilling.registrationId, row.id),
      ),
    );
  return toRecord(row, guests, contacts, billing);
}

/** The registration of the reservation the current guest session belongs to. */
export async function getRegistrationForReservation(
  db: Database,
  context: TenantContext,
  key: ReservationKey,
): Promise<GuestRegistrationRecord | undefined> {
  assertTenantContext(context);
  assertReservationKey(key);
  const [row] = await db
    .select()
    .from(guestRegistrations)
    .where(
      and(
        eq(guestRegistrations.tenantId, context.tenantId),
        eq(guestRegistrations.reservationProvider, key.reservationProvider),
        eq(guestRegistrations.externalReservationId, key.externalReservationId),
      ),
    );
  return withGuests(db, context, row);
}

export async function getRegistrationById(
  db: Database,
  context: TenantContext,
  id: string,
): Promise<GuestRegistrationRecord | undefined> {
  assertTenantContext(context);
  if (!UUID.test(id)) return undefined;
  const [row] = await db
    .select()
    .from(guestRegistrations)
    .where(and(eq(guestRegistrations.tenantId, context.tenantId), eq(guestRegistrations.id, id)));
  return withGuests(db, context, row);
}

export type StartRegistrationInput = ReservationKey & {
  propertyId: string;
  guestCount: number;
  guestCountSource: GuestCountSource;
  arrivalAt: Date;
  departureAt: Date;
};

function assertGuestCount(count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > MAX_TRAVELLERS) {
    throw new RangeError("Invalid guest count");
  }
}

/**
 * Creates the reservation's registration or returns the existing one. While it is a
 * draft, the stay window (and a reservation-sourced guest count) follow the PMS.
 */
export async function startRegistration(
  db: Database,
  context: TenantContext,
  input: StartRegistrationInput,
): Promise<GuestRegistrationRecord> {
  assertTenantContext(context);
  assertReservationKey(input);
  assertGuestCount(input.guestCount);
  if (!isEntityKey(input.propertyId)) throw new TypeError("Invalid property id");
  await db
    .insert(guestRegistrations)
    .values({
      tenantId: context.tenantId,
      propertyId: input.propertyId,
      reservationProvider: input.reservationProvider,
      externalReservationId: input.externalReservationId,
      guestCount: input.guestCount,
      guestCountSource: input.guestCountSource,
      arrivalAt: input.arrivalAt,
      departureAt: input.departureAt,
    })
    .onConflictDoUpdate({
      target: [
        guestRegistrations.tenantId,
        guestRegistrations.reservationProvider,
        guestRegistrations.externalReservationId,
      ],
      set: {
        arrivalAt: input.arrivalAt,
        departureAt: input.departureAt,
        guestCount: sql`CASE WHEN ${guestRegistrations.guestCountSource} = 'reservation' AND ${input.guestCountSource} = 'reservation' THEN ${input.guestCount} ELSE ${guestRegistrations.guestCount} END`,
        // A changed occupancy is never silent: the guest sees a notice until the next save.
        guestCountChangedAt: sql`CASE WHEN ${guestRegistrations.guestCountSource} = 'reservation' AND ${input.guestCountSource} = 'reservation' AND ${guestRegistrations.guestCount} <> ${input.guestCount} THEN now() ELSE ${guestRegistrations.guestCountChangedAt} END`,
        updatedAt: new Date(),
      },
      setWhere: and(
        eq(guestRegistrations.status, "draft"),
        // Never move a registration to another property.
        eq(guestRegistrations.propertyId, input.propertyId),
      ),
    });
  const record = await getRegistrationForReservation(db, context, input);
  if (!record || record.propertyId !== input.propertyId) {
    throw new Error("Registration belongs to another property");
  }
  return record;
}

export type WriteResult =
  { ok: true; version: number } | { ok: false; reason: "not-found" | "submitted" | "conflict" };

async function failureReason(
  db: Pick<Database, "select">,
  context: TenantContext,
  id: string,
): Promise<WriteResult> {
  const [row] = await db
    .select({ status: guestRegistrations.status })
    .from(guestRegistrations)
    .where(and(eq(guestRegistrations.tenantId, context.tenantId), eq(guestRegistrations.id, id)));
  if (!row) return { ok: false, reason: "not-found" };
  return { ok: false, reason: row.status === "submitted" ? "submitted" : "conflict" };
}

/**
 * Saves travellers of a draft (whole guests per position are replaced). Rejects stale
 * versions and submitted registrations. Optionally changes a guest-sourced count.
 */
/** Contact data (e-mail, phone) of one traveller slot – kept apart from the legal data. */
async function upsertContact(
  tx: Pick<Database, "insert" | "select" | "update">,
  tenantId: string,
  registrationId: string,
  guest: Pick<RegistrationGuest, "position" | "data">,
): Promise<void> {
  const values = { email: guest.data.email ?? null, phone: guest.data.phone ?? null };
  const [previous] = await tx
    .select({ email: guestRegistrationContacts.email, phone: guestRegistrationContacts.phone })
    .from(guestRegistrationContacts)
    .where(
      and(
        eq(guestRegistrationContacts.tenantId, tenantId),
        eq(guestRegistrationContacts.registrationId, registrationId),
        eq(guestRegistrationContacts.position, guest.position),
      ),
    );
  // Only a change away from an earlier value can void a confirmation (first entry cannot).
  const emailChanged = Boolean(previous?.email) && previous?.email !== values.email;
  const phoneChanged = Boolean(previous?.phone) && previous?.phone !== values.phone;
  // A changed value is no longer the confirmed (or waived) one – the guest confirms again.
  const resetEmail = emailChanged
    ? { emailVerifiedAt: null, emailVerifiedHash: null, ...clearedWaiver("email") }
    : {};
  const resetPhone = phoneChanged
    ? { phoneVerifiedAt: null, phoneVerifiedHash: null, ...clearedWaiver("phone") }
    : {};
  await tx
    .insert(guestRegistrationContacts)
    .values({ tenantId, registrationId, position: guest.position, ...values })
    .onConflictDoUpdate({
      target: [guestRegistrationContacts.registrationId, guestRegistrationContacts.position],
      set: { ...values, ...resetEmail, ...resetPhone, updatedAt: new Date() },
    });
  const now = new Date();
  for (const [channel, changed] of [
    ["email", emailChanged],
    ["sms", phoneChanged],
  ] as const) {
    if (!changed) continue;
    // Codes sent to the old value are void.
    await tx
      .update(contactVerificationChallenges)
      .set({ status: "superseded", updatedAt: now })
      .where(
        and(
          eq(contactVerificationChallenges.tenantId, tenantId),
          eq(contactVerificationChallenges.registrationId, registrationId),
          eq(contactVerificationChallenges.position, guest.position),
          eq(contactVerificationChallenges.channel, channel),
          eq(contactVerificationChallenges.status, "pending"),
        ),
      );
    await tx.insert(contactVerificationEvents).values({
      tenantId,
      registrationId,
      position: guest.position,
      channel,
      event: "reset-by-change",
      actor: "guest",
      occurredAt: now,
    });
  }
}

function clearedWaiver(channel: "email" | "phone") {
  return channel === "email"
    ? { emailWaivedAt: null, emailWaivedBy: null, emailWaiverReason: null, emailWaiverNote: null }
    : { phoneWaivedAt: null, phoneWaivedBy: null, phoneWaiverReason: null, phoneWaiverNote: null };
}

export async function saveRegistrationGuests(
  db: Database,
  context: TenantContext,
  id: string,
  expectedVersion: number,
  guests: readonly RegistrationGuest[],
  options: { guestCount?: number } = {},
): Promise<WriteResult> {
  assertTenantContext(context);
  if (!UUID.test(id)) return { ok: false, reason: "not-found" };
  if (options.guestCount !== undefined) assertGuestCount(options.guestCount);
  for (const guest of guests) {
    if (
      !Number.isInteger(guest.position) ||
      guest.position < 0 ||
      guest.position >= MAX_TRAVELLERS
    ) {
      throw new RangeError("Invalid guest position");
    }
  }
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(guestRegistrations)
      .set({
        version: sql`${guestRegistrations.version} + 1`,
        updatedAt: new Date(),
        // The guest has seen the current set of travellers.
        guestCountChangedAt: null,
        ...(options.guestCount === undefined
          ? {}
          : {
              guestCount: sql`CASE WHEN ${guestRegistrations.guestCountSource} = 'guest' THEN ${options.guestCount} ELSE ${guestRegistrations.guestCount} END`,
            }),
      })
      .where(
        and(
          eq(guestRegistrations.tenantId, context.tenantId),
          eq(guestRegistrations.id, id),
          eq(guestRegistrations.status, "draft"),
          eq(guestRegistrations.version, expectedVersion),
        ),
      )
      .returning({ version: guestRegistrations.version });
    if (!updated) return failureReason(tx, context, id);
    const existing =
      guests.length === 0
        ? []
        : await tx
            .select()
            .from(guestRegistrationGuests)
            .where(
              and(
                eq(guestRegistrationGuests.tenantId, context.tenantId),
                eq(guestRegistrationGuests.registrationId, id),
              ),
            );
    const existingContacts =
      guests.length === 0
        ? []
        : await tx
            .select()
            .from(guestRegistrationContacts)
            .where(
              and(
                eq(guestRegistrationContacts.tenantId, context.tenantId),
                eq(guestRegistrationContacts.registrationId, id),
              ),
            );
    for (const guest of guests) {
      const columns = toColumns(guest);
      const prefilledFields = keptPrefilled(
        existing.find((row) => row.position === guest.position),
        existingContacts.find((row) => row.position === guest.position),
        guest.data,
      );
      await tx
        .insert(guestRegistrationGuests)
        .values({
          tenantId: context.tenantId,
          registrationId: id,
          position: guest.position,
          role: guest.position === 0 ? "primary" : "companion",
          ...columns,
          prefilledFields,
        })
        .onConflictDoUpdate({
          target: [guestRegistrationGuests.registrationId, guestRegistrationGuests.position],
          set: { ...columns, prefilledFields, updatedAt: new Date() },
        });
      await upsertContact(tx, context.tenantId, id, guest);
    }
    return { ok: true, version: updated.version };
  });
}

/**
 * Inserts prefilled travellers (from the PMS) into empty slots of a draft – never touches a
 * slot that already holds data. Returns the number of slots filled.
 */
export async function seedRegistrationGuests(
  db: Database,
  context: TenantContext,
  id: string,
  guests: readonly RegistrationGuest[],
): Promise<number> {
  assertTenantContext(context);
  if (!UUID.test(id) || guests.length === 0) return 0;
  return db.transaction(async (tx) => {
    const [draft] = await tx
      .select({ guestCount: guestRegistrations.guestCount })
      .from(guestRegistrations)
      .where(
        and(
          eq(guestRegistrations.tenantId, context.tenantId),
          eq(guestRegistrations.id, id),
          eq(guestRegistrations.status, "draft"),
        ),
      );
    if (!draft) return 0;
    const rows = guests
      .filter((guest) => guest.position >= 0 && guest.position < draft.guestCount)
      .map((guest) => ({
        tenantId: context.tenantId,
        registrationId: id,
        position: guest.position,
        role: guest.position === 0 ? ("primary" as const) : ("companion" as const),
        ...toColumns(guest),
        prefilledFields: [...(guest.prefilledFields ?? [])],
      }));
    if (rows.length === 0) return 0;
    const inserted = await tx
      .insert(guestRegistrationGuests)
      .values(rows)
      .onConflictDoNothing()
      .returning({ position: guestRegistrationGuests.position });
    for (const { position } of inserted) {
      const guest = guests.find((item) => item.position === position);
      if (guest) await upsertContact(tx, context.tenantId, id, guest);
    }
    return inserted.length;
  });
}

/**
 * The reservation is the source of truth for how many people travel. When its occupancy
 * changes while the check-in is a draft, the slots follow and the change is flagged (no
 * data is deleted; slots beyond the new count are ignored and dropped on submit).
 */
export async function syncRegistrationOccupancy(
  db: Database,
  context: TenantContext,
  id: string,
  guestCount: number,
  now: Date,
): Promise<boolean> {
  assertTenantContext(context);
  if (!UUID.test(id)) return false;
  assertGuestCount(guestCount);
  const updated = await db
    .update(guestRegistrations)
    .set({
      guestCount,
      guestCountChangedAt: now,
      version: sql`${guestRegistrations.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(guestRegistrations.tenantId, context.tenantId),
        eq(guestRegistrations.id, id),
        eq(guestRegistrations.status, "draft"),
        eq(guestRegistrations.guestCountSource, "reservation"),
        ne(guestRegistrations.guestCount, guestCount),
      ),
    )
    .returning({ id: guestRegistrations.id });
  return updated.length > 0;
}

export type SubmitResult =
  { ok: true; alreadySubmitted: boolean } | { ok: false; reason: "not-found" | "conflict" };

/**
 * Draft → submitted, exactly once. Travellers beyond the guest count are dropped, one
 * pending sync per target is created. Repeating the call (double click, retry, second
 * tab) is a no-op that reports success.
 */
export async function submitRegistration(
  db: Database,
  context: TenantContext,
  id: string,
  input: {
    expectedVersion: number;
    targets: readonly RegistrationTarget[];
    now: Date;
    purgeAfter?: Date;
    /** Contact data retention (ADR 0021); defaults to the registration's purge date. */
    contactPurgeAfter?: Date;
  },
): Promise<SubmitResult> {
  assertTenantContext(context);
  if (!UUID.test(id)) return { ok: false, reason: "not-found" };
  return db.transaction(async (tx) => {
    const [submitted] = await tx
      .update(guestRegistrations)
      .set({
        status: "submitted",
        submittedAt: input.now,
        purgeAfter: input.purgeAfter ?? null,
        version: sql`${guestRegistrations.version} + 1`,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(guestRegistrations.tenantId, context.tenantId),
          eq(guestRegistrations.id, id),
          eq(guestRegistrations.status, "draft"),
          eq(guestRegistrations.version, input.expectedVersion),
        ),
      )
      .returning({ guestCount: guestRegistrations.guestCount });
    if (!submitted) {
      const reason = await failureReason(tx, context, id);
      if (!reason.ok && reason.reason === "submitted") return { ok: true, alreadySubmitted: true };
      return {
        ok: false,
        reason: !reason.ok && reason.reason === "not-found" ? "not-found" : "conflict",
      };
    }
    await tx
      .delete(guestRegistrationGuests)
      .where(
        and(
          eq(guestRegistrationGuests.tenantId, context.tenantId),
          eq(guestRegistrationGuests.registrationId, id),
          gte(guestRegistrationGuests.position, submitted.guestCount),
        ),
      );
    await tx
      .delete(guestRegistrationContacts)
      .where(
        and(
          eq(guestRegistrationContacts.tenantId, context.tenantId),
          eq(guestRegistrationContacts.registrationId, id),
          gte(guestRegistrationContacts.position, submitted.guestCount),
        ),
      );
    const contactPurgeAfter = input.contactPurgeAfter ?? input.purgeAfter;
    if (contactPurgeAfter) {
      await tx
        .update(guestRegistrationContacts)
        .set({ purgeAfter: contactPurgeAfter, updatedAt: input.now })
        .where(
          and(
            eq(guestRegistrationContacts.tenantId, context.tenantId),
            eq(guestRegistrationContacts.registrationId, id),
          ),
        );
    }
    if (input.targets.length > 0) {
      await tx
        .insert(guestRegistrationSyncs)
        .values(
          [...new Set(input.targets)].map((provider) => ({
            tenantId: context.tenantId,
            registrationId: id,
            provider,
          })),
        )
        .onConflictDoNothing();
    }
    return { ok: true, alreadySubmitted: false };
  });
}

/* ------------------------------------------------------------------------------------------
 * Sync state
 * ---------------------------------------------------------------------------------------- */

export type RegistrationSyncRecord = {
  id: string;
  tenantId: string;
  registrationId: string;
  provider: RegistrationTarget;
  status: SyncStatus;
  attempts: number;
  lastAttemptAt?: Date;
  nextAttemptAt?: Date;
  lastErrorCode?: SyncErrorCode;
  externalReference?: string;
  fingerprint?: string;
  syncedAt?: Date;
};

type SyncRow = typeof guestRegistrationSyncs.$inferSelect;

function toSync(row: SyncRow): RegistrationSyncRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    registrationId: row.registrationId,
    provider: row.provider,
    status: row.status,
    attempts: row.attempts,
    ...(row.lastAttemptAt ? { lastAttemptAt: row.lastAttemptAt } : {}),
    ...(row.nextAttemptAt ? { nextAttemptAt: row.nextAttemptAt } : {}),
    ...(row.lastErrorCode ? { lastErrorCode: row.lastErrorCode } : {}),
    ...(row.externalReference ? { externalReference: row.externalReference } : {}),
    ...(row.fingerprint ? { fingerprint: row.fingerprint } : {}),
    ...(row.syncedAt ? { syncedAt: row.syncedAt } : {}),
  };
}

/** Sync state of one registration (diagnostics, later admin views). */
export async function listRegistrationSyncs(
  db: Database,
  context: TenantContext,
  registrationId: string,
): Promise<RegistrationSyncRecord[]> {
  assertTenantContext(context);
  if (!UUID.test(registrationId)) return [];
  const rows = await db
    .select()
    .from(guestRegistrationSyncs)
    .where(
      and(
        eq(guestRegistrationSyncs.tenantId, context.tenantId),
        eq(guestRegistrationSyncs.registrationId, registrationId),
      ),
    )
    .orderBy(asc(guestRegistrationSyncs.provider));
  return rows.map(toSync);
}

/**
 * Atomically claims due syncs of the given providers (system operation, all tenants):
 * pending/retry_required whose time has come, plus "processing" rows whose lease expired
 * (a crashed worker). Claimed rows are "processing" with attempts + 1. SKIP LOCKED lets
 * parallel workers never pick the same row.
 */
export async function claimDueSyncs(
  db: Database,
  input: { now: Date; providers: readonly RegistrationTarget[]; limit: number; leaseMs: number },
): Promise<RegistrationSyncRecord[]> {
  if (input.providers.length === 0) return [];
  const leaseExpired = new Date(input.now.getTime() - input.leaseMs);
  const due = db
    .select({ id: guestRegistrationSyncs.id })
    .from(guestRegistrationSyncs)
    .where(
      and(
        inArray(guestRegistrationSyncs.provider, [...input.providers]),
        or(
          and(
            inArray(guestRegistrationSyncs.status, ["pending", "retry_required"]),
            or(
              isNull(guestRegistrationSyncs.nextAttemptAt),
              lte(guestRegistrationSyncs.nextAttemptAt, input.now),
            ),
          ),
          and(
            eq(guestRegistrationSyncs.status, "processing"),
            lt(guestRegistrationSyncs.lastAttemptAt, leaseExpired),
          ),
        ),
      ),
    )
    .orderBy(asc(guestRegistrationSyncs.createdAt))
    .limit(Math.max(1, Math.min(input.limit, 100)))
    .for("update", { skipLocked: true });
  const rows = await db
    .update(guestRegistrationSyncs)
    .set({
      status: "processing",
      attempts: sql`${guestRegistrationSyncs.attempts} + 1`,
      lastAttemptAt: input.now,
      updatedAt: input.now,
    })
    .where(inArray(guestRegistrationSyncs.id, due))
    .returning();
  return rows.map(toSync);
}

/** Records the outcome of a claimed attempt (only while the row is still "processing"). */
export async function completeSyncAttempt(
  db: Database,
  context: TenantContext,
  syncId: string,
  result: {
    status: Exclude<SyncStatus, "processing" | "pending">;
    now: Date;
    nextAttemptAt?: Date;
    errorCode?: SyncErrorCode;
    externalReference?: string;
    fingerprint?: string;
  },
): Promise<boolean> {
  assertTenantContext(context);
  if (!UUID.test(syncId)) return false;
  const synced = result.status === "synced";
  const updated = await db
    .update(guestRegistrationSyncs)
    .set({
      status: result.status,
      nextAttemptAt: result.nextAttemptAt ?? null,
      lastErrorCode: synced ? null : (result.errorCode ?? "unknown"),
      ...(synced
        ? {
            syncedAt: result.now,
            ...(result.externalReference ? { externalReference: result.externalReference } : {}),
            ...(result.fingerprint ? { fingerprint: result.fingerprint } : {}),
          }
        : {}),
      updatedAt: result.now,
    })
    .where(
      and(
        eq(guestRegistrationSyncs.tenantId, context.tenantId),
        eq(guestRegistrationSyncs.id, syncId),
        eq(guestRegistrationSyncs.status, "processing"),
      ),
    )
    .returning({ id: guestRegistrationSyncs.id });
  return updated.length > 0;
}

/**
 * Retention (system operation): deletes the travellers' personal data, contact data and
 * billing data of registrations whose purge date has passed, and contact data whose own
 * (shorter) purge date has passed. Metadata (status, sync state) stays for traceability.
 */
export async function purgeExpiredRegistrationData(db: Database, now: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const expired = await tx
      .update(guestRegistrations)
      .set({ purgedAt: now, updatedAt: now })
      .where(
        and(
          isNotNull(guestRegistrations.purgeAfter),
          lte(guestRegistrations.purgeAfter, now),
          isNull(guestRegistrations.purgedAt),
        ),
      )
      .returning({ id: guestRegistrations.id, tenantId: guestRegistrations.tenantId });
    // Operational contact data has its own (usually shorter) retention – the code challenges
    // of a removed contact go with it (the audit events hold no contact data and stay).
    const purgedContacts = await tx
      .delete(guestRegistrationContacts)
      .where(
        and(
          isNotNull(guestRegistrationContacts.purgeAfter),
          lte(guestRegistrationContacts.purgeAfter, now),
        ),
      )
      .returning({ registrationId: guestRegistrationContacts.registrationId });
    const contactRegistrations = [...new Set(purgedContacts.map((row) => row.registrationId))];
    if (contactRegistrations.length > 0) {
      await tx
        .delete(contactVerificationChallenges)
        .where(inArray(contactVerificationChallenges.registrationId, contactRegistrations));
    }
    if (expired.length === 0) return 0;
    const ids = expired.map((row) => row.id);
    await tx
      .delete(guestRegistrationGuests)
      .where(inArray(guestRegistrationGuests.registrationId, ids));
    await tx
      .delete(guestRegistrationContacts)
      .where(inArray(guestRegistrationContacts.registrationId, ids));
    await tx
      .delete(guestRegistrationBilling)
      .where(inArray(guestRegistrationBilling.registrationId, ids));
    await tx
      .delete(contactVerificationChallenges)
      .where(inArray(contactVerificationChallenges.registrationId, ids));
    return expired.length;
  });
}

/* ------------------------------------------------------------------------------------------
 * Billing (invoice recipient, ADR 0021)
 * ---------------------------------------------------------------------------------------- */

/**
 * Saves the invoice recipient of a draft (optimistic concurrency like the guests). Never
 * touches the private registration address; nothing is sent to the PMS.
 */
export async function saveRegistrationBilling(
  db: Database,
  context: TenantContext,
  id: string,
  expectedVersion: number,
  billing: BillingChoice,
): Promise<WriteResult> {
  assertTenantContext(context);
  if (!UUID.test(id)) return { ok: false, reason: "not-found" };
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(guestRegistrations)
      .set({ version: sql`${guestRegistrations.version} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(guestRegistrations.tenantId, context.tenantId),
          eq(guestRegistrations.id, id),
          eq(guestRegistrations.status, "draft"),
          eq(guestRegistrations.version, expectedVersion),
        ),
      )
      .returning({ version: guestRegistrations.version });
    if (!updated) return failureReason(tx, context, id);
    const values =
      billing.kind === "private"
        ? {
            kind: "private" as const,
            companyName: null,
            street: null,
            postalCode: null,
            city: null,
            country: null,
            vatId: null,
            contactFirstName: null,
            contactLastName: null,
            addressStatus: null,
          }
        : {
            kind: "company" as const,
            companyName: billing.companyName,
            street: billing.street,
            postalCode: billing.postalCode ?? null,
            city: billing.city,
            country: billing.country,
            vatId: billing.vatId ?? null,
            contactFirstName: billing.contactPerson?.firstName ?? null,
            contactLastName: billing.contactPerson?.lastName ?? null,
            addressStatus: assessAddress({
              street: billing.street,
              ...(billing.postalCode ? { postalCode: billing.postalCode } : {}),
              city: billing.city,
              country: billing.country,
            }).status,
          };
    await tx
      .insert(guestRegistrationBilling)
      .values({ tenantId: context.tenantId, registrationId: id, ...values })
      .onConflictDoUpdate({
        target: [guestRegistrationBilling.tenantId, guestRegistrationBilling.registrationId],
        set: { ...values, updatedAt: new Date() },
      });
    return { ok: true, version: updated.version };
  });
}
