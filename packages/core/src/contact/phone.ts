/**
 * International phone numbers (ADR 0016) with libphonenumber-js (Google's metadata, offline,
 * no external API). Stored as E.164 ("+491701234567"); entered as calling-code + number.
 */
import {
  type CountryCode,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from "libphonenumber-js/max";

export type PhoneCheck =
  { ok: true; e164: string; country?: string } | { ok: false; reason: "invalid" | "not-mobile" };

/** Number types that clearly cannot receive calls/messages on a mobile phone. */
const NOT_MOBILE = new Set([
  "FIXED_LINE",
  "TOLL_FREE",
  "PREMIUM_RATE",
  "SHARED_COST",
  "PAGER",
  "UAN",
  "VOICEMAIL",
]);

function isCountryCodeValue(value: string | undefined): value is CountryCode {
  return value !== undefined && (getCountries() as readonly string[]).includes(value);
}

/**
 * Parses what a guest typed. "+…" / "00…" are international; anything else is read in
 * the selected (or default) country. Valid mobile-capable numbers → E.164.
 */
export function normalizePhone(input: string, country?: string): PhoneCheck {
  const raw = input.trim().replace(/^00(?=[1-9])/, "+");
  if (raw.length < 3 || raw.length > 40 || /[^\d\s()+./-]/.test(raw)) {
    return { ok: false, reason: "invalid" };
  }
  const parsed = parsePhoneNumberFromString(
    raw,
    raw.startsWith("+") || !isCountryCodeValue(country) ? undefined : country,
  );
  if (!parsed?.isValid()) return { ok: false, reason: "invalid" };
  const type = parsed.getType();
  if (type && NOT_MOBILE.has(type)) return { ok: false, reason: "not-mobile" };
  return { ok: true, e164: parsed.number, ...(parsed.country ? { country: parsed.country } : {}) };
}

/** E.164 → country and national number, for prefilling the two-part field. */
export function splitPhone(e164: string): { country?: string; national: string } {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return { national: e164 };
  return {
    ...(parsed.country ? { country: parsed.country } : {}),
    national: parsed.formatNational(),
  };
}

/** Readable international format, e.g. "+49 170 1234567". */
export function formatPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

/** Calling-code options in the guest's language, e.g. { value: "DE", code: "+49", name: "Deutschland" }. */
export function callingCodeOptions(
  locale: string,
): { value: string; code: string; name: string }[] {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  return getCountries()
    .map((country) => ({
      value: country,
      code: `+${getCountryCallingCode(country)}`,
      name: names.of(country) ?? country,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}
