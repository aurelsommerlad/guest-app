import { Container, Heading, Icon, Stack, Text, buttonStyles } from "@up/ui";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { serverEnv } from "../../../../env/server";
import { SectionPlaceholder } from "../../../../features/placeholder/SectionPlaceholder";
import { routing } from "../../../../i18n/routing";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  });
  return { title: t("metadata.extras") };
}

/**
 * Extras stay a separate app (extras.unique-places.com). The link carries no reservation
 * or guest data – a secure hand-over is a proposal in ADR 0016, not built yet.
 */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  // Rendered per request: the Extras URL is runtime configuration, not build input.
  await connection();
  const url = serverEnv.EXTRAS_APP_URL;
  if (!url) {
    const t = await getTranslations("metadata");
    return <SectionPlaceholder title={t("extras")} />;
  }
  const t = await getTranslations("extras");
  return (
    <div className="safe-top">
      <Container width="content" className="md:max-w-reading lg:pt-10">
        <main className="pt-12 pb-16 lg:pt-20">
          <Stack gap={6}>
            <Stack gap={3}>
              <Heading level={1}>{t("title")}</Heading>
              <Text variant="lead" tone="muted" className="text-balance">
                {t("body")}
              </Text>
            </Stack>
            <a
              href={url}
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              className={buttonStyles("primary", "self-start")}
            >
              {t("open")}
              <Icon name="arrow-right" size="sm" />
              <span className="sr-only"> ({t("external")})</span>
            </a>
          </Stack>
        </main>
      </Container>
    </div>
  );
}
