import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { locale as rootLocale } from "next/root-params";

import type de from "../../messages/de.json";
import { routing } from "./routing";

/** The locale comes from the root [locale] segment via next/root-params. */
export default getRequestConfig(async () => {
  const requested = await rootLocale();
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const messages = (await import(`../../messages/${locale}.json`)) as { default: typeof de };
  return { locale, messages: messages.default };
});
