import { COUNTRY_CODES } from "@up/core";
import { type SelectOption } from "@up/ui";

/** Country options in the guest's language (Intl.DisplayNames – no translated list to maintain). */
export function countryOptions(locale: string): SelectOption[] {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  return COUNTRY_CODES.map((code) => ({ value: code, label: names.of(code) ?? code })).sort(
    (a, b) => a.label.localeCompare(b.label, locale),
  );
}
