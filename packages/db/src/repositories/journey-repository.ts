/**
 * Guest journey settings per property and encrypted key box codes per unit
 * (ADR 0016/0017). Tenant-scoped; settings are validated with the @up/core schemas on
 * write *and* read, so a hand-edited row can never feed the guest app invalid rules.
 */
import {
  DEFAULT_ACCESS_CONFIG,
  isEntityKey,
  type PropertyAccessConfig,
  propertyAccessConfigSchema,
  type PropertyRegistrationConfig,
  propertyRegistrationConfigSchema,
  REGISTRATION_DISABLED,
  type TenantContext,
} from "@up/core";
import { and, eq } from "drizzle-orm";

import { type Database } from "../client";
import { propertyJourneySettings, unitAccessCodes } from "../schema";

export type JourneySettings = {
  registration: PropertyRegistrationConfig;
  access: PropertyAccessConfig;
  /** False when the property has no row – the defaults below apply. */
  configured: boolean;
};

/** Stored settings that no longer match the schema (fail closed, never guess). */
export class JourneySettingsError extends Error {
  override name = "JourneySettingsError";
}

function assertTenantContext(context: TenantContext): void {
  if (!isEntityKey(context.tenantId)) throw new TypeError("Invalid tenant context");
}

const DEFAULTS: JourneySettings = {
  registration: REGISTRATION_DISABLED,
  access: DEFAULT_ACCESS_CONFIG,
  configured: false,
};

export async function getJourneySettings(
  db: Database,
  context: TenantContext,
  propertyId: string,
): Promise<JourneySettings> {
  assertTenantContext(context);
  if (!isEntityKey(propertyId)) return DEFAULTS;
  const [row] = await db
    .select({
      registration: propertyJourneySettings.registration,
      access: propertyJourneySettings.access,
    })
    .from(propertyJourneySettings)
    .where(
      and(
        eq(propertyJourneySettings.tenantId, context.tenantId),
        eq(propertyJourneySettings.propertyId, propertyId),
      ),
    );
  if (!row) return DEFAULTS;
  const registration = propertyRegistrationConfigSchema.safeParse(row.registration);
  const access = propertyAccessConfigSchema.safeParse(row.access);
  if (!registration.success || !access.success) {
    throw new JourneySettingsError("Stored journey settings are invalid");
  }
  return { registration: registration.data, access: access.data, configured: true };
}

/** Validates and stores both documents (operator/admin use; never from the guest app). */
export async function saveJourneySettings(
  db: Database,
  context: TenantContext,
  propertyId: string,
  settings: { registration: unknown; access: unknown },
): Promise<void> {
  assertTenantContext(context);
  if (!isEntityKey(propertyId)) throw new TypeError("Invalid property id");
  const registration = propertyRegistrationConfigSchema.parse(settings.registration);
  const access = propertyAccessConfigSchema.parse(settings.access);
  await db
    .insert(propertyJourneySettings)
    .values({ tenantId: context.tenantId, propertyId, registration, access })
    .onConflictDoUpdate({
      target: [propertyJourneySettings.tenantId, propertyJourneySettings.propertyId],
      set: { registration, access, updatedAt: new Date() },
    });
}

export type UnitKey = { propertyId: string; unitId: string };

function unitWhere(context: TenantContext, key: UnitKey) {
  return and(
    eq(unitAccessCodes.tenantId, context.tenantId),
    eq(unitAccessCodes.propertyId, key.propertyId),
    eq(unitAccessCodes.unitId, key.unitId),
  );
}

/** Stores an already encrypted code (encryption happens in the app with ACCESS_CODE_KEY). */
export async function setUnitAccessCode(
  db: Database,
  context: TenantContext,
  key: UnitKey,
  codeCiphertext: string,
): Promise<void> {
  assertTenantContext(context);
  if (!isEntityKey(key.propertyId) || !isEntityKey(key.unitId)) {
    throw new TypeError("Invalid unit key");
  }
  await db
    .insert(unitAccessCodes)
    .values({ tenantId: context.tenantId, ...key, codeCiphertext })
    .onConflictDoUpdate({
      target: [unitAccessCodes.tenantId, unitAccessCodes.propertyId, unitAccessCodes.unitId],
      set: { codeCiphertext, updatedAt: new Date() },
    });
}

export async function getUnitAccessCode(
  db: Database,
  context: TenantContext,
  key: UnitKey,
): Promise<{ codeCiphertext: string; updatedAt: Date } | undefined> {
  assertTenantContext(context);
  if (!isEntityKey(key.propertyId) || !isEntityKey(key.unitId)) return undefined;
  const [row] = await db
    .select({
      codeCiphertext: unitAccessCodes.codeCiphertext,
      updatedAt: unitAccessCodes.updatedAt,
    })
    .from(unitAccessCodes)
    .where(unitWhere(context, key));
  return row;
}

export async function deleteUnitAccessCode(
  db: Database,
  context: TenantContext,
  key: UnitKey,
): Promise<boolean> {
  assertTenantContext(context);
  if (!isEntityKey(key.propertyId) || !isEntityKey(key.unitId)) return false;
  const deleted = await db
    .delete(unitAccessCodes)
    .where(unitWhere(context, key))
    .returning({ unitId: unitAccessCodes.unitId });
  return deleted.length > 0;
}
