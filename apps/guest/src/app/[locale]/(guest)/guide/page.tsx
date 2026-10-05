import { Container, Heading, LinkList, Text } from "@up/ui";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { BrandHeader } from "../../../../components/GuestHeader";
import { getGuideOverview, getGuideProperty } from "../../../../features/guide/get-guide";
import { Link } from "../../../../i18n/navigation";
import { routing } from "../../../../i18n/routing";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  });
  return { title: t("metadata.guide") };
}

/** GUIDE overview – the digital guest folder. */
export default async function GuidePage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations("guide");
  const sections = getGuideOverview(locale);

  return (
    <div className="safe-top">
      <Container width="content" className="md:max-w-reading lg:max-w-content lg:pt-10">
        <BrandHeader property={getGuideProperty()} />

        <main className="lg:max-w-reading">
          <div className="mt-6 flex flex-col gap-3 lg:mt-16">
            <Text variant="eyebrow" tone="muted">
              {t("eyebrow")}
            </Text>
            <Heading level={1}>{t("title")}</Heading>
            <Text variant="lead" tone="muted" className="max-w-72 text-balance">
              {t("intro")}
            </Text>
          </div>

          <section aria-labelledby="guide-sections-heading" className="mt-8 lg:mt-12">
            <h2 id="guide-sections-heading" className="sr-only">
              {t("sectionsHeading")}
            </h2>
            <LinkList items={sections} headingLevel={3} linkComponent={Link} />
          </section>
        </main>
      </Container>
    </div>
  );
}
