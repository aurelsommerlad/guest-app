import { defineRouting } from "next-intl/routing";

/** Supported interface languages. Content translations live in the data (LocalizedText). */
export const routing = defineRouting({
  locales: ["de", "en"],
  defaultLocale: "de",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
