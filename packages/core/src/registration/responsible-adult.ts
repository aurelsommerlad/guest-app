/**
 * The responsible arriving person (main guest) must be of age (ADR 0021). Checked on the
 * server from the declared birth date against the local arrival date.
 *
 * The result is a *declaration* check: a birth date the guest typed proves nothing. The
 * status therefore never says "verified" – an actual age check is only possible with an
 * identity document (identityCheck, done by staff).
 */
import { ageOn, isValidIsoDate } from "./dates";

export const DEFAULT_RESPONSIBLE_ADULT_MIN_AGE = 18;
/** Older declared ages are treated as a typing error. */
export const MAX_PLAUSIBLE_AGE = 120;

export const AGE_DECLARATION_STATUSES = [
  "missing",
  "invalid",
  "declared-under-age",
  "declared-adult",
] as const;
export type AgeDeclarationStatus = (typeof AGE_DECLARATION_STATUSES)[number];

export function responsibleAdultStatus(
  birthDate: string | undefined,
  arrivalDate: string,
  minAge: number = DEFAULT_RESPONSIBLE_ADULT_MIN_AGE,
): AgeDeclarationStatus {
  if (birthDate === undefined || birthDate.trim() === "") return "missing";
  const value = birthDate.trim();
  if (!isValidIsoDate(value) || !isValidIsoDate(arrivalDate)) return "invalid";
  if (value > arrivalDate) return "invalid";
  const age = ageOn(value, arrivalDate);
  if (age > MAX_PLAUSIBLE_AGE) return "invalid";
  return age >= minAge ? "declared-adult" : "declared-under-age";
}
