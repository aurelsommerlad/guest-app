import { buttonStyles, Container, Heading, Stack, Text } from "@up/ui";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { Link } from "../../../i18n/navigation";
import { routing } from "../../../i18n/routing";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "access.invalidLink",
  });
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

/**
 * The one page for every unusable guest link (unknown, expired, not yet valid, revoked,
 * reservation no longer active). Reveals nothing about the reason or the reservation.
 */
export default async function InvalidLinkPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const [t, tHeader] = await Promise.all([
    getTranslations("access.invalidLink"),
    getTranslations("header"),
  ]);

  return (
    <div className="safe-top">
      <Container width="content" className="md:max-w-reading lg:pt-10">
        <header className="flex min-h-11 items-center">
          <p className="type-wordmark text-text">{tHeader("brand")}</p>
        </header>
        <main className="pt-12 pb-16 lg:pt-20">
          <Stack gap={4}>
            <Heading level={1} className="max-w-reading text-balance">
              {t("title")}
            </Heading>
            <Text variant="lead" tone="muted" className="max-w-80 text-balance">
              {t("body")}
            </Text>
          </Stack>
          <Link href="/login" className={buttonStyles("secondary", "mt-8")}>
            {t("login")}
          </Link>
        </main>
      </Container>
    </div>
  );
}
