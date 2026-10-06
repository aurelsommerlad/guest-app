import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { locale as rootLocale } from "next/root-params";
import type { ReactNode } from "react";

import { routing } from "../../i18n/routing";
import { documentMetadata, documentViewport } from "../_components/document-metadata";
import { RootDocument } from "../_components/RootDocument";

export const metadata = documentMetadata;
export const viewport = documentViewport;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Unknown locales (e.g. /fr/stay) are 404s instead of being rendered on demand.
export const dynamicParams = false;

/** Root layout of the guest app. `<html lang>` always matches the URL locale. */
export default async function LocaleLayout({ children }: Readonly<{ children: ReactNode }>) {
  const locale = await rootLocale();
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Client components get only the strings they need; everything else stays on the server.
  const messages = await getMessages();
  return (
    <RootDocument lang={locale}>
      <NextIntlClientProvider
        messages={{
          stayError: messages.stayError,
          access: { login: messages.access.login },
          // Client forms of the online check-in and the access code reveal.
          checkIn: messages.checkIn,
          stay: { access: messages.stay.access },
        }}
      >
        {children}
      </NextIntlClientProvider>
    </RootDocument>
  );
}
