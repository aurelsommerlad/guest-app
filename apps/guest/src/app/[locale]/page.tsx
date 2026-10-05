import { hasLocale } from "next-intl";
import { locale as rootLocale } from "next/root-params";

import { redirect } from "../../i18n/navigation";
import { routing } from "../../i18n/routing";

/** /de → /de/stay: STAY is the guest's home. */
export default async function LocaleIndex() {
  const locale = await rootLocale();
  redirect({
    href: "/stay",
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  });
}
